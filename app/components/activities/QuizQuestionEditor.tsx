import { useState } from "react";

export interface EditableQuizQuestion {
  question: string;
  options: string[];
  answer: string;
}

const emptyQuestion = (): EditableQuizQuestion => ({
  question: "",
  options: ["", "", "", ""],
  answer: "A",
});

export function QuizQuestionEditor({ initialQuestions }: { initialQuestions: unknown }) {
  const [questions, setQuestions] = useState<EditableQuizQuestion[]>(() => {
    if (!Array.isArray(initialQuestions) || initialQuestions.length === 0) return [emptyQuestion()];
    return initialQuestions.map((item) => {
      const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const options = Array.isArray(value.options) ? value.options.map(String).slice(0, 4) : [];
      return {
        question: String(value.question || ""),
        options: [...options, ...Array(Math.max(0, 4 - options.length)).fill("")],
        answer: String(value.answer || value.correctOption || "A").toUpperCase(),
      };
    });
  });

  const updateQuestion = (index: number, update: Partial<EditableQuizQuestion>) => {
    setQuestions((current) => current.map((question, questionIndex) =>
      questionIndex === index ? { ...question, ...update } : question,
    ));
  };

  return (
    <div>
      <input type="hidden" name="quiz_questions_json" value={JSON.stringify(questions)} />
      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px" }}>
        Add as many questions as you need. Each correct answer earns 50 points; customers can retry questions they miss.
      </p>
      {questions.map((question, index) => (
        <fieldset key={index} style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: 12, margin: "0 0 10px" }}>
          <legend style={{ fontWeight: 700, padding: "0 5px" }}>Question {index + 1}</legend>
          <input
            aria-label={`Question ${index + 1}`}
            value={question.question}
            onChange={(event) => updateQuestion(index, { question: event.target.value })}
            placeholder="Enter the question"
            required
            style={{ width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 5, boxSizing: "border-box", marginBottom: 8 }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            {question.options.map((option, optionIndex) => {
              const key = String.fromCharCode(65 + optionIndex);
              return (
                <input
                  key={key}
                  aria-label={`Question ${index + 1} option ${key}`}
                  value={option}
                  onChange={(event) => updateQuestion(index, { options: question.options.map((item, itemIndex) => itemIndex === optionIndex ? event.target.value : item) })}
                  placeholder={`Option ${key}`}
                  required
                  style={{ width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 5, boxSizing: "border-box" }}
                />
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 9 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Correct answer: {" "}
              <select value={question.answer} onChange={(event) => updateQuestion(index, { answer: event.target.value })}>
                {question.options.map((_, optionIndex) => {
                  const key = String.fromCharCode(65 + optionIndex);
                  return <option key={key} value={key}>Option {key}</option>;
                })}
              </select>
            </label>
            <button type="button" onClick={() => setQuestions((current) => current.filter((_, questionIndex) => questionIndex !== index))} style={{ color: "#b91c1c", border: 0, background: "transparent", cursor: "pointer" }}>
              Remove question
            </button>
          </div>
        </fieldset>
      ))}
      <button type="button" onClick={() => setQuestions((current) => [...current, emptyQuestion()])} style={{ border: "1px solid #d1d5db", background: "white", borderRadius: 6, padding: "7px 12px", cursor: "pointer" }}>
        + Add question
      </button>
    </div>
  );
}
