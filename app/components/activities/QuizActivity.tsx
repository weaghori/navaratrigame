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
          <div style={{ display: "grid", gap: 8 }}>
            {(question.options || []).map((option, optionIndex) => {
              const optionKey = String.fromCharCode(65 + optionIndex);
              const inputId = `quiz-${questionIndex}-${optionKey}`;
              const selected = answers[String(questionIndex)] === optionKey;
              return (
                <label key={inputId} htmlFor={inputId} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `2px solid ${selected ? "#d97706" : "#e2e8f0"}`, background: selected ? "#fffbeb" : "#fff", color: "#1e293b", cursor: isSubmitting ? "not-allowed" : "pointer" }}>
                  <input
                    id={inputId}
                    type="radio"
                    name={`quiz-question-${questionIndex}`}
                    value={optionKey}
                    checked={selected}
                    disabled={isSubmitting}
                    onChange={() => setAnswers((current) => ({ ...current, [String(questionIndex)]: optionKey }))}
                  />
                  <span style={{ fontWeight: 800, color: "#92400e" }}>{optionKey}.</span>
                  <span>{option}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {error && <p role="alert" style={{ margin: 0, color: "#fecaca", fontWeight: 700 }}>{error}</p>}
      <p style={{ margin: 0, color: "#cbd5d1", fontSize: 12, lineHeight: 1.5 }}>
        Answer every question, then submit once. Your total is 50 points for each correct answer.
      </p>
      <button type="submit" disabled={!isComplete || isSubmitting} style={{ width: "100%", padding: "13px 16px", border: 0, borderRadius: 10, background: !isComplete || isSubmitting ? "#64748b" : "linear-gradient(135deg, #d97706, #b45309)", color: "#fff", fontWeight: 800, cursor: !isComplete || isSubmitting ? "not-allowed" : "pointer" }}>
        {isSubmitting ? "Submitting quiz…" : isComplete ? "Submit all answers & see total points" : `Answer all ${questions.length} questions to submit`}
      </button>
    </form>
  );
}
