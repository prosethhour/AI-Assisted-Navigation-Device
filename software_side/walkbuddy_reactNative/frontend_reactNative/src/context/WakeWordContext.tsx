import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { getTTSService, RiskLevel } from "../services/TTSService";
import { matchVoiceCommand, VOICE_COMMAND_HELP } from "../services/VoiceCommandService";

const STORAGE_KEY = "@walkbuddy/wake-word-enabled";
const WAKE_PHRASE = "hey walkbuddy";

type WakeWordContextValue = {
  enabled: boolean;
  available: boolean;
  listening: boolean;
  status: string;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  pause: (reason?: string) => void;
  resume: (reason?: string) => void;
};

const WakeWordContext = createContext<WakeWordContextValue | null>(null);

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function WakeWordProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const tts = useMemo(() => getTTSService({ cooldownSeconds: 1.2 }), []);
  const speechModuleRef = useRef<any>(null);
  const mountedRef = useRef(true);
  const appActiveRef = useRef(AppState.currentState === "active");
  const enabledRef = useRef(false);
  const listeningRef = useRef(false);
  const processingRef = useRef(false);
  const modeRef = useRef<"wake" | "command">("wake");
  const pauseReasonsRef = useRef(new Set<string>());
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [enabled, setEnabledState] = useState(false);
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Wake activation is off");

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      speechModuleRef.current?.abort?.();
    } catch {}
    listeningRef.current = false;
    if (mountedRef.current) setListening(false);
  }, []);

  const startWakeListening = useCallback(async () => {
    const speechModule = speechModuleRef.current;
    if (
      !speechModule ||
      !enabledRef.current ||
      !appActiveRef.current ||
      pauseReasonsRef.current.size > 0 ||
      processingRef.current ||
      listeningRef.current
    ) {
      return;
    }

    try {
      const permission = await speechModule.getPermissionsAsync();
      if (!permission.granted) {
        if (mountedRef.current) setStatus("Speech permission is required");
        return;
      }

      modeRef.current = "wake";
      speechModule.start({
        lang: "en-AU",
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
        contextualStrings: ["Hey WalkBuddy", "WalkBuddy"],
      });
    } catch (error) {
      console.warn("[Wake Word] Unable to start:", error);
      if (mountedRef.current) setStatus("Wake activation is unavailable");
    }
  }, []);

  const scheduleWakeRestart = useCallback(
    (delayMs = 500) => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        void startWakeListening();
      }, delayMs);
    },
    [startWakeListening],
  );

  const speakAndNavigate = useCallback(
    async (message: string, pathname: string, params?: Record<string, string>) => {
      await tts.speak(message, RiskLevel.LOW, true);
      router.push({ pathname: pathname as any, params } as any);
    },
    [router, tts],
  );

  const runForegroundCommand = useCallback(
    async (commandText: string) => {
      const command = matchVoiceCommand(commandText);

      switch (command) {
        case "help":
          await tts.speak(VOICE_COMMAND_HELP, RiskLevel.LOW, true);
          return;
        case "repeat-guidance": {
          const previousMessage = tts.getStatus().lastMessage;
          await tts.speak(
            previousMessage || "There is no previous guidance to repeat.",
            RiskLevel.LOW,
            true,
          );
          return;
        }
        case "read-text":
          await speakAndNavigate("Opening the text reader.", "/camera", { mode: "ocr" });
          return;
        case "describe-surroundings":
          await speakAndNavigate("Opening Vision Assist.", "/camera");
          return;
        case "stop-speaking":
          tts.stop();
          return;
        case "go-home":
          await tts.speak("Going home.", RiskLevel.LOW, true);
          router.replace("/" as any);
          return;
        case "go-back":
          await tts.speak("Going back.", RiskLevel.LOW, true);
          router.back();
          return;
        case "open-places":
          await speakAndNavigate("Opening places.", "/places");
          return;
        case "open-audiobooks":
          await speakAndNavigate("Opening audiobooks.", "/audiobooks");
          return;
        case "open-favourites":
          await speakAndNavigate("Opening favourites.", "/favourites");
          return;
        case "open-indoor-navigation":
          await speakAndNavigate("Opening indoor navigation.", "/indoor");
          return;
        case "open-outdoor-navigation":
          await speakAndNavigate("Opening outdoor navigation.", "/exterior");
          return;
        case "open-predictive-path":
          await speakAndNavigate("Opening predictive path.", "/predictive-path");
          return;
        case "open-ask-a-friend":
          await speakAndNavigate("Opening Ask a Friend.", "/ask-a-friend-web");
          return;
        case "open-emergency":
          await tts.speak("Opening the emergency screen.", RiskLevel.HIGH, true);
          router.push("/emergency" as any);
          return;
        default:
          await tts.speak(
            "I did not recognize that command. Say Hey WalkBuddy, help, to hear the command list.",
            RiskLevel.LOW,
            true,
          );
      }
    },
    [router, speakAndNavigate, tts],
  );

  const startCommandListening = useCallback(() => {
    const speechModule = speechModuleRef.current;
    if (!speechModule || !enabledRef.current || !appActiveRef.current) return;
    modeRef.current = "command";
    try {
      speechModule.start({
        lang: "en-AU",
        interimResults: false,
        continuous: false,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
        contextualStrings: [
          "read text",
          "describe surroundings",
          "repeat guidance",
          "indoor navigation",
          "outdoor navigation",
          "ask a friend",
        ],
      });
    } catch (error) {
      console.warn("[Wake Word] Unable to listen for command:", error);
      processingRef.current = false;
      scheduleWakeRestart();
    }
  }, [scheduleWakeRestart]);

  const handleWakePhrase = useCallback(
    async (transcript: string) => {
      if (processingRef.current) return;
      const lower = transcript.toLowerCase();
      const wakeIndex = lower.indexOf(WAKE_PHRASE);
      if (wakeIndex < 0) return;

      processingRef.current = true;
      stopRecognition();
      tts.stop();
      const trailingCommand = transcript
        .slice(wakeIndex + WAKE_PHRASE.length)
        .replace(/^[,\s-]+/, "")
        .trim();

      await delay(250);

      if (trailingCommand) {
        if (mountedRef.current) setStatus(`Command: ${trailingCommand}`);
        await runForegroundCommand(trailingCommand);
        processingRef.current = false;
        if (mountedRef.current) setStatus("Listening for Hey WalkBuddy");
        scheduleWakeRestart(700);
        return;
      }

      await tts.speak("I'm listening.", RiskLevel.LOW, true);
      processingRef.current = false;
      if (mountedRef.current) setStatus("Listening for a command");
      await delay(200);
      startCommandListening();
    },
    [runForegroundCommand, scheduleWakeRestart, startCommandListening, stopRecognition, tts],
  );

  const handleCommandResult = useCallback(
    async (transcript: string) => {
      if (processingRef.current || !transcript.trim()) return;
      processingRef.current = true;
      stopRecognition();
      if (mountedRef.current) setStatus(`Command: ${transcript.trim()}`);
      await delay(200);
      await runForegroundCommand(transcript.trim());
      processingRef.current = false;
      if (mountedRef.current) setStatus("Listening for Hey WalkBuddy");
      scheduleWakeRestart(700);
    },
    [runForegroundCommand, scheduleWakeRestart, stopRecognition],
  );

  useEffect(() => {
    mountedRef.current = true;
    let speechPackage: any = null;
    try {
      // Dynamic loading keeps Expo Go usable; the native module only exists in
      // a WalkBuddy development build.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      speechPackage = require("expo-speech-recognition");
      const speechModule = speechPackage.ExpoSpeechRecognitionModule;
      const isAvailable = Boolean(speechModule?.isRecognitionAvailable?.());
      speechModuleRef.current = isAvailable ? speechModule : null;
      setAvailable(isAvailable);
      if (!isAvailable) setStatus("Requires a WalkBuddy development build");
    } catch (error) {
      console.warn("[Wake Word] Native speech module unavailable:", error);
      setAvailable(false);
      setStatus("Requires a WalkBuddy development build");
    }

    return () => {
      mountedRef.current = false;
      stopRecognition();
    };
  }, [stopRecognition]);

  useEffect(() => {
    const speechModule = speechModuleRef.current;
    if (!available || !speechModule) return;

    const startSubscription = speechModule.addListener("start", () => {
      listeningRef.current = true;
      if (mountedRef.current) {
        setListening(true);
        setStatus(
          modeRef.current === "wake"
            ? "Listening for Hey WalkBuddy"
            : "Listening for a command",
        );
      }
    });

    const resultSubscription = speechModule.addListener("result", (event: any) => {
      const transcript = event.results?.[0]?.transcript?.trim() || "";
      if (!transcript) return;
      if (modeRef.current === "wake") {
        void handleWakePhrase(transcript);
      } else if (event.isFinal) {
        void handleCommandResult(transcript);
      }
    });

    const endSubscription = speechModule.addListener("end", () => {
      listeningRef.current = false;
      if (mountedRef.current) setListening(false);
      if (!processingRef.current) {
        if (modeRef.current === "command") {
          modeRef.current = "wake";
          if (mountedRef.current) setStatus("No command heard. Listening for Hey WalkBuddy");
        }
        scheduleWakeRestart();
      }
    });

    const errorSubscription = speechModule.addListener("error", (event: any) => {
      listeningRef.current = false;
      if (mountedRef.current) setListening(false);
      if (event.error !== "aborted" && event.error !== "no-speech") {
        console.warn("[Wake Word] Recognition error:", event.error, event.message);
        if (mountedRef.current) setStatus(`Wake activation error: ${event.error}`);
      }
      if (!processingRef.current) {
        modeRef.current = "wake";
        scheduleWakeRestart(1000);
      }
    });

    return () => {
      startSubscription.remove();
      resultSubscription.remove();
      endSubscription.remove();
      errorSubscription.remove();
    };
  }, [available, handleCommandResult, handleWakePhrase, scheduleWakeRestart]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    void (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (cancelled || saved !== "true") return;
      const permission = await speechModuleRef.current?.getPermissionsAsync?.();
      if (cancelled || !permission?.granted) return;
      enabledRef.current = true;
      setEnabledState(true);
      scheduleWakeRestart(300);
    })();
    return () => {
      cancelled = true;
    };
  }, [available, scheduleWakeRestart]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appActiveRef.current = nextState === "active";
      if (appActiveRef.current) {
        scheduleWakeRestart(500);
      } else {
        stopRecognition();
        if (mountedRef.current && enabledRef.current) {
          setStatus("Paused while WalkBuddy is in the background");
        }
      }
    });
    return () => subscription.remove();
  }, [scheduleWakeRestart, stopRecognition]);

  const setEnabled = useCallback(
    async (nextEnabled: boolean) => {
      const speechModule = speechModuleRef.current;
      if (nextEnabled) {
        if (!speechModule) {
          setStatus("Requires a WalkBuddy development build");
          return false;
        }
        const permission = await speechModule.requestPermissionsAsync();
        if (!permission.granted) {
          setStatus("Microphone and speech permissions were not granted");
          return false;
        }
      }

      enabledRef.current = nextEnabled;
      setEnabledState(nextEnabled);
      await AsyncStorage.setItem(STORAGE_KEY, String(nextEnabled));

      if (nextEnabled) {
        setStatus("Listening for Hey WalkBuddy");
        scheduleWakeRestart(200);
      } else {
        stopRecognition();
        setStatus("Wake activation is off");
      }
      return true;
    },
    [scheduleWakeRestart, stopRecognition],
  );

  const pause = useCallback(
    (reason = "manual") => {
      pauseReasonsRef.current.add(reason);
      stopRecognition();
      if (mountedRef.current && enabledRef.current) setStatus("Wake activation paused");
    },
    [stopRecognition],
  );

  const resume = useCallback(
    (reason = "manual") => {
      pauseReasonsRef.current.delete(reason);
      if (pauseReasonsRef.current.size === 0 && enabledRef.current) {
        setStatus("Listening for Hey WalkBuddy");
        scheduleWakeRestart(400);
      }
    },
    [scheduleWakeRestart],
  );

  const value = useMemo(
    () => ({ enabled, available, listening, status, setEnabled, pause, resume }),
    [available, enabled, listening, pause, resume, setEnabled, status],
  );

  return <WakeWordContext.Provider value={value}>{children}</WakeWordContext.Provider>;
}

export function useWakeWord() {
  const context = useContext(WakeWordContext);
  if (!context) throw new Error("useWakeWord must be used inside WakeWordProvider");
  return context;
}
