import type { ScoringEnv, SpeechScore } from "./types";

// 正解文なし（ReferenceText 空）の発音評価と抑揚の評価を、短い音声用の REST で呼ぶ
// https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short
const assessmentHeader = btoa(
  JSON.stringify({
    ReferenceText: "",
    GradingSystem: "HundredMark",
    Granularity: "Word",
    Dimension: "Comprehensive",
    EnableMiscue: false,
    EnableProsodyAssessment: true,
  }),
);

type Word = {
  Word?: string;
  AccuracyScore?: number;
  ErrorType?: string;
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
};

type NBest = {
  Display?: string;
  Words?: Word[];
  AccuracyScore?: number;
  FluencyScore?: number;
  ProsodyScore?: number;
  // 古い形式では点数がこの下に入る
  PronunciationAssessment?: {
    AccuracyScore?: number;
    FluencyScore?: number;
    ProsodyScore?: number;
  };
};

type AzureResponse = {
  RecognitionStatus: string;
  NBest?: NBest[];
};

export class AzureError extends Error {}

// 何も聞き取れなかったときは null を返す
export async function assessSpeech(
  env: ScoringEnv,
  wav: ArrayBuffer,
): Promise<SpeechScore | null> {
  if (!env.AZURE_API_KEY || !env.AZURE_LOCATION) {
    throw new AzureError("AZURE_API_KEY と AZURE_LOCATION が要る");
  }
  const url = `https://${env.AZURE_LOCATION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.AZURE_API_KEY,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      "Pronunciation-Assessment": assessmentHeader,
      Accept: "application/json",
    },
    body: wav,
  });
  if (!res.ok) {
    throw new AzureError(`Azure ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as AzureResponse;
  if (
    body.RecognitionStatus === "NoMatch" ||
    body.RecognitionStatus === "InitialSilenceTimeout"
  ) {
    return null;
  }
  const best = body.NBest?.[0];
  if (body.RecognitionStatus !== "Success" || !best) {
    throw new AzureError(`Azure の認識に失敗: ${body.RecognitionStatus}`);
  }
  const pa = best.PronunciationAssessment ?? {};
  const accuracy = best.AccuracyScore ?? pa.AccuracyScore ?? 0;
  const fluency = best.FluencyScore ?? pa.FluencyScore ?? 0;
  const prosody = best.ProsodyScore ?? pa.ProsodyScore ?? 0;
  return {
    transcript: best.Display ?? "",
    accuracy,
    fluency,
    prosody,
    score: (accuracy + fluency + prosody) / 3,
    words: (best.Words ?? []).map((w) => ({
      word: w.Word ?? "",
      accuracy:
        w.AccuracyScore ?? w.PronunciationAssessment?.AccuracyScore ?? 0,
      errorType: w.ErrorType ?? w.PronunciationAssessment?.ErrorType ?? "None",
    })),
  };
}
