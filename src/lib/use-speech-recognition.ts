"use client";

// Thin wrapper around the browser-native Web Speech API
// (SpeechRecognition / webkitSpeechRecognition). Free, no API key, no server
// round-trip. Supported: Chrome (desktop + Android), Safari 14.1+/14.5+ via
// the webkit prefix. NOT supported in Firefox (behind a flag) - callers must
// feature-detect via `supported` and hide any mic UI when it's false.

import { useCallback, useEffect, useRef, useState } from "react";

// ---- Minimal local types for the API -------------------------------------
// TypeScript's bundled DOM lib does not fully declare the Web Speech API, so
// we declare only the shapes this hook actually touches rather than pulling
// in a types package.

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  }
}

// ---- Pure helpers (exported for tests) ------------------------------------

/**
 * Appends a new chunk of recognized speech onto whatever text is already
 * there, joining with a single space and skipping empty chunks. Used both to
 * accumulate finalized speech-recognition results into a running transcript,
 * and to append that transcript (or its live interim tail) onto text the
 * user had already typed before starting dictation.
 */
export function appendFinalResult(prev: string, chunk: string): string {
  const trimmedChunk = chunk.trim();
  if (!trimmedChunk) return prev;
  if (!prev) return trimmedChunk;
  return `${prev} ${trimmedChunk}`;
}

/** Maps a SpeechRecognition error code to a user-facing Hebrew message. */
export function mapSpeechError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "אין הרשאה למיקרופון. אפשרו גישה בהגדרות הדפדפן.";
    case "no-speech":
      return "לא נשמע כלום, נסו שוב.";
    case "network":
      return "אין חיבור לשירות ההקלדה הקולית.";
    default:
      return "ההקלדה הקולית נתקלה בתקלה. נסו שוב.";
  }
}

interface UseSpeechRecognitionResult {
  /** False during SSR and on browsers without the API (e.g. Firefox). */
  supported: boolean;
  listening: boolean;
  /** Live, not-yet-finalized text for the current utterance. */
  interim: string;
  /** Finalized transcript accumulated since the last `start()`. */
  transcript: string;
  start: () => void;
  stop: () => void;
  error: string;
}

export function useSpeechRecognition(): UseSpeechRecognitionResult {
  // Starts false on both server and first client render to avoid a
  // hydration mismatch, then flips true (if supported) after mount.
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition));
  }, []);

  // Never leave the mic hot: abort any live session on unmount.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (listening) return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    setError("");
    setTranscript("");
    setInterim("");

    const recognition = new Ctor();
    recognition.lang = "he-IL";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let newFinal = "";
      let latestInterim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          newFinal = appendFinalResult(newFinal, text);
        } else {
          latestInterim = text;
        }
      }
      if (newFinal) {
        setTranscript((prev) => appendFinalResult(prev, newFinal));
      }
      setInterim(latestInterim);
    };

    recognition.onerror = (event) => {
      setError(mapSpeechError(event.error));
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim("");
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [listening]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { supported, listening, interim, transcript, start, stop, error };
}
