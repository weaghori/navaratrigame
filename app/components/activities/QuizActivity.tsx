import React, { useMemo, useState } from "react";

export interface QuizConfig {
  question?: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  questions?: Array<{ question?: string; options?: string[]; answer?: string; correctOption?: string }>;
  passingScore?: number;
}

interface QuizActivityProps {
  levelId: string;
  points: number;
  config: QuizConfig;
  onSubmit: (selectedOption: string) => void;
  isSubmitting: boolean;
  error?: string | null;
}

export function QuizActivity({ config, onSubmit, isSubmitting, error }: QuizActivityProps) {
  const questions = useMemo(() => {
    if (config.questions?.length) return config.questions;
    return [{
      question: config.question,
      options: [config.optionA, config.optionB, config.optionC, config.optionD].filter((option): option is string => Boolean(option)),
    }];
  }, [config]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answeredCount = Object.keys(answers).length;
  const isComplete = answeredCount === questions.length;

  const submitQuiz = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !isComplete) return;
    onSubmit(JSON.stringify(answers));
  };

  if (!questions.length) return <p role="alert">This quiz has no questions configured.</p>;

  return (
    <form onSubmit={submitQuiz} style={{ width: "100%", display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#f4d27a", fontSize: 13, fontWeight: 700 }}>
        <span>{answeredCount} of {questions.length} answered</span>
        <span>50 points per correct answer</span>
      </div>

      <div role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={answeredCount} style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,.24)", overflow: "hidden" }}>
        <div style={{ width: `${(answeredCount / questions.length) * 100}%`, height: "100%", background: "#f59e0b", transition: "width 180ms ease" }} />
      </div>

      {questions.map((question, questionIndex) => (
        <fieldset key={questionIndex} style={{ margin: 0, minWidth: 0, border: "1px solid rgba(255,255,255,.35)", borderRadius: 10, padding: 12 }}>
          <legend style={{ padding: "0 6px", color: "#fff4ce", fontSize: 15, fontWeight: 800, lineHeight: 1.4 }}>
            {question.question || `Question ${questionIndex + 1}`}
          </legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(question.options || []).map((option, optionIndex) => {
              const optionKey = String.fromCharCode(65 + optionIndex);
              const inputId = `quiz-${questionIndex}-${optionKey}`;
              const selected = answers[String(questionIndex)] === optionKey;
              return (
                <label key={inputId} htmlFor={inputId} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `2px solid ${selected ? "#fbbf24" : "rgba(255,255,255,0.3)"}`, background: selected ? "rgba(251, 191, 36, 0.15)" : "transparent", color: "#fff", cursor: isSubmitting ? "not-allowed" : "pointer", transition: "all 0.2s ease" }}>
                  <input
                    id={inputId}
                    type="radio"
                    name={`quiz-question-${questionIndex}`}
                    value={optionKey}
                    checked={selected}
                    disabled={isSubmitting}
                    onChange={() => setAnswers((current) => ({ ...current, [String(questionIndex)]: optionKey }))}
                  />
                  <span style={{ fontWeight: 900, color: selected ? "#fbbf24" : "#fef08a" }}>{optionKey}.</span>
                  <span style={{ fontWeight: 600, color: "#fff" }}>{option}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {error && <p role="alert" style={{ margin: 0, color: "#fecaca", fontWeight: 700 }}>{error}</p>}
      <div style={{ position: "sticky", bottom: -2, padding: "10px 0", background: "inherit", zIndex: 10, display: "grid", gap: 8 }}>
        <p style={{ margin: 0, color: "#cbd5d1", fontSize: 12, lineHeight: 1.5, background: "rgba(15, 23, 42, 0.9)", padding: 6, borderRadius: 6 }}>
          Answer every question, then submit once. Your total is 50 points for each correct answer.
        </p>
        <button type="submit" disabled={!isComplete || isSubmitting} style={{ width: "100%", padding: "13px 16px", border: 0, borderRadius: 10, background: !isComplete || isSubmitting ? "#64748b" : "linear-gradient(135deg, #d97706, #b45309)", color: "#fff", fontWeight: 800, cursor: !isComplete || isSubmitting ? "not-allowed" : "pointer", boxShadow: "0 -4px 12px rgba(0,0,0,0.2)" }}>
          {isSubmitting ? "Submitting quiz…" : isComplete ? "Submit all answers & see total points" : `Answer all ${questions.length} questions to submit`}
        </button>
      </div>
    </form>
  );
}
