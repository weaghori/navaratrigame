export type QuizQuestionForScoring = {
  answer?: unknown;
  correctOption?: unknown;
  options?: unknown;
};

export function scoreQuizAnswers(
  questions: QuizQuestionForScoring[],
  userAnswers: Record<string, string>,
) {
  const correctIndexes = questions.flatMap((question, index) => {
    const expected = String(question.answer || question.correctOption || "").trim().toUpperCase();
    return expected && expected === userAnswers[String(index)] ? [index] : [];
  });
  const allAnswered = questions.every((question, index) => {
    const answer = userAnswers[String(index)] || "";
    const optionCount = Array.isArray(question.options) ? question.options.length : 4;
    return /^[A-D]$/.test(answer) && answer.charCodeAt(0) - 64 <= optionCount;
  });

  return { correctIndexes, allAnswered };
}