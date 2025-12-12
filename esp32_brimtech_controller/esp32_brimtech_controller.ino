#include <WiFi.h>
#include <HTTPClient.h>

// --- CONFIG --- //
const char* ssid     = "TP-Link_F6B8";
const char* password = "21580260";

// Worker endpoints
const char* WORKER_CMD_URL   = "https://christmas-tree.christmas-tree.workers.dev/cmd";
const char* WORKER_STATE_URL = "https://christmas-tree.christmas-tree.workers.dev/state";

// LED pins (ESP32-C3 Mini)
#define LED1_PIN 2
#define LED2_PIN 8
#define LED3_PIN 10

// PWM channels
const int CH1 = 0;
const int CH2 = 1;
const int CH3 = 2;

unsigned long lastPoll = 0;
const unsigned long POLL_INTERVAL = 2000;

// Program global (pentru viitor: efecte predefinite)
String programMode = "none";

struct LedState {
  String mode;       // "off", "on", "blink", "fade", "sparkle"
  int intensity;     // 0..255
  bool blinkState;   // pentru blink
  int fadeVal;       // pentru fade / sparkle
  int fadeStep;      // pentru fade
};

LedState led1, led2, led3;
unsigned long lastEffect1 = 0;
unsigned long lastEffect2 = 0;
unsigned long lastEffect3 = 0;

// ---------------- PROTO ----------------
void connectWiFi();
void reconnectWiFi();
void checkForCommand();
void parseAndApplyCommand(const String& cmd);
void applyLedImmediate(LedState& led, int channel);
void handleEffects();
void handleLedEffect(LedState& led, int channel, unsigned long now, unsigned long &lastTs);
void sendState();
void resetLedState(LedState& led);

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);

  pinMode(LED1_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);
  pinMode(LED3_PIN, OUTPUT);

  digitalWrite(LED1_PIN, LOW);
  digitalWrite(LED2_PIN, LOW);
  digitalWrite(LED3_PIN, LOW);

  ledcSetup(CH1, 5000, 8);
  ledcSetup(CH2, 5000, 8);
  ledcSetup(CH3, 5000, 8);

  ledcAttachPin(LED1_PIN, CH1);
  ledcAttachPin(LED2_PIN, CH2);
  ledcAttachPin(LED3_PIN, CH3);

  // stari initiale
  resetLedState(led1);
  resetLedState(led2);
  resetLedState(led3);

  connectWiFi();
}

// ---------------- LOOP ----------------
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    reconnectWiFi();
  }

  unsigned long now = millis();

  if (now - lastPoll >= POLL_INTERVAL) {
    lastPoll = now;
    checkForCommand();
  }

  handleEffects();
}

// ---------------- WIFI ----------------
void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected, IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi connect failed");
  }
}

void reconnectWiFi() {
  Serial.println("Reconnecting WiFi...");
  WiFi.disconnect();
  connectWiFi();
}

// ---------------- COMENZI ----------------
void checkForCommand() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(WORKER_CMD_URL);
  int code = http.GET();

  if (code == 200) {
    String cmd = http.getString();
    cmd.trim();
    Serial.print("Received CMD: ");
    Serial.println(cmd);

    if (cmd != "" && cmd != "none") {
      parseAndApplyCommand(cmd);
      sendState();
    }
  } else {
    Serial.print("HTTP error: ");
    Serial.println(code);
  }
  http.end();
}

// Format comanda (3 LED-uri): L1:mode:int;L2:mode:int;L3:mode:int;P:program
// ex: L1:on:200;L2:fade:150;L3:blink:255;P:none
void parseAndApplyCommand(const String& cmd) {
  String work = cmd;

  auto applyToLed = [](LedState& led, int intensity, const String& mode, unsigned long& lastTs, int channel) {
    led.mode = mode;
    led.intensity = intensity;
    led.blinkState = false;
    led.fadeVal = 0;
    led.fadeStep = 4;
    lastTs = millis();
    applyLedImmediate(led, channel);
  };

  while (work.length() > 0) {
    int sep = work.indexOf(';');
    String part;
    if (sep == -1) {
      part = work;
      work = "";
    } else {
      part = work.substring(0, sep);
      work = work.substring(sep + 1);
    }
    part.trim();
    if (part.length() == 0) continue;

    if (part.startsWith("L1:") || part.startsWith("L2:") || part.startsWith("L3:")) {
      int first = part.indexOf(':');
      int second = part.indexOf(':', first + 1);
      String mode = (second == -1) ? part.substring(first + 1)
                                   : part.substring(first + 1, second);
      mode.trim();
      int intensity = 255;
      if (second != -1) {
        intensity = part.substring(second + 1).toInt();
        if (intensity < 0) intensity = 0;
        if (intensity > 255) intensity = 255;
      }

      if (part.startsWith("L1:")) {
        applyToLed(led1, intensity, mode, lastEffect1, CH1);
      } else if (part.startsWith("L2:")) {
        applyToLed(led2, intensity, mode, lastEffect2, CH2);
      } else if (part.startsWith("L3:")) {
        applyToLed(led3, intensity, mode, lastEffect3, CH3);
      }

    } else if (part.startsWith("P:")) {
      String p = part.substring(2);
      p.trim();
      if (p.length() == 0) p = "none";
      programMode = p;
    }
  }

  Serial.print("L1 mode=");
  Serial.print(led1.mode);
  Serial.print(" int=");
  Serial.print(led1.intensity);
  Serial.print(" | L2 mode=");
  Serial.print(led2.mode);
  Serial.print(" int=");
  Serial.print(led2.intensity);
  Serial.print(" | L3 mode=");
  Serial.print(led3.mode);
  Serial.print(" int=");
  Serial.println(led3.intensity);
}

void applyLedImmediate(LedState& led, int channel) {
  if (led.mode == "off") {
    ledcWrite(channel, 0);
  } else if (led.mode == "on") {
    ledcWrite(channel, led.intensity);
  }
  // pentru moduri cu efect (blink/fade/sparkle), handleEffects se ocupa
}

// ---------------- EFECTE ----------------
void handleEffects() {
  unsigned long now = millis();

  // daca programMode vrei sa faca ceva global (ex: "alternate"), se poate trata aici.
  if (programMode == "none") {
    handleLedEffect(led1, CH1, now, lastEffect1);
    handleLedEffect(led2, CH2, now, lastEffect2);
    handleLedEffect(led3, CH3, now, lastEffect3);
  } else if (programMode == "alternate") {
    // simplu: aprindem pe rand LED1, LED2, LED3
    static int altState = 0;
    static unsigned long lastAlt = 0;
    if (now - lastAlt >= 500) {
      lastAlt = now;
      altState = (altState + 1) % 3;
      ledcWrite(CH1, altState == 0 ? 255 : 0);
      ledcWrite(CH2, altState == 1 ? 255 : 0);
      ledcWrite(CH3, altState == 2 ? 255 : 0);
    }
  }
}

void handleLedEffect(LedState& led, int channel, unsigned long now, unsigned long &lastTs) {
  if (led.mode == "off") {
    ledcWrite(channel, 0);
    return;
  }
  if (led.mode == "on") {
    ledcWrite(channel, led.intensity);
    return;
  }

  // BLINK
  if (led.mode == "blink") {
    if (now - lastTs >= 500) {
      lastTs = now;
      led.blinkState = !led.blinkState;
      int val = led.blinkState ? led.intensity : 0;
      ledcWrite(channel, val);
    }
    return;
  }

  // FADE (up/down)
  if (led.mode == "fade") {
    if (now - lastTs >= 20) {
      lastTs = now;
      led.fadeVal += led.fadeStep;
      if (led.fadeVal >= led.intensity || led.fadeVal <= 0) {
        led.fadeStep = -led.fadeStep;
      }
      int val = led.fadeVal;
      if (val < 0) val = 0;
      if (val > 255) val = 255;
      ledcWrite(channel, val);
    }
    return;
  }

  // SPARKLE - intensitate random
  if (led.mode == "sparkle") {
    if (now - lastTs >= 80) {
      lastTs = now;
      int r = random(0, 100);
      int val = (r > 60) ? led.intensity : random(0, led.intensity / 4 + 1);
      ledcWrite(channel, val);
    }
    return;
  }

  // necunoscut -> off
  ledcWrite(channel, 0);
}

// ---------------- STATE REPORT ----------------
void sendState() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(WORKER_STATE_URL);
  http.addHeader("Content-Type", "application/json");

  String payload = "{";
  payload += "\"led1_mode\":\"" + led1.mode + "\",";
  payload += "\"led1_intensity\":" + String(led1.intensity) + ",";
  payload += "\"led2_mode\":\"" + led2.mode + "\",";
  payload += "\"led2_intensity\":" + String(led2.intensity) + ",";
  payload += "\"led3_mode\":\"" + led3.mode + "\",";
  payload += "\"led3_intensity\":" + String(led3.intensity) + ",";
  payload += "\"program\":\"" + programMode + "\"";
  payload += "}";

  int code = http.POST(payload);
  Serial.print("POST /state => ");
  Serial.println(code);
  http.end();
}

void resetLedState(LedState& led) {
  led.mode = "off";
  led.intensity = 0;
  led.blinkState = false;
  led.fadeVal = 0;
  led.fadeStep = 4;
}
