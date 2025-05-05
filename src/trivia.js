const { sendSimpleRequestToClaude } = require("./claude");
const { sendSimpleRequestToDeepSeek } = require("./deepseek");
const MongoDB = require("./mongo");

function sendRandomQuizz(chatId) {
	return new Promise(async (resolve, reject) => {
		const dbInstance = MongoDB.getInstance();
		await dbInstance.connect("messages");
		const db = dbInstance.getDb();
		const mongoCollection = db.collection("jeopardy");

		const questionDoc = (
			await mongoCollection.aggregate([/* { $match: { Question: { $regex: "href=", $options: "i" } } },  */ { $sample: { size: 1 } }]).toArray()
		)[0];
		try {
			const response = await sendSimpleRequestToDeepSeek(
				`You are a trivia expert AI. Your task is to enhance a trivia question for a quiz game. Given the following trivia question: "${questionDoc.Question}" in the category '${questionDoc.Category}' and its correct answer: "${questionDoc.Answer}", perform the following tasks:
1. Generate three distinct, plausible, and contextually relevant incorrect answers. Ensure they are short, not overly similar to the correct answer, and MUST match the style, tone, and format of the correct answer (e.g., if the correct answer is "chilly (chili)", the incorrect answers should follow the same style, if the correct answer is like "Ceylon (or Sri Lanka)" the wrong answers should also imitate that with the parenthesis).
2. Reformulate the question to make it clearer and easier to understand, without making the correct answer too obvious.
3. Provide a fun fact or explanation (up to 200 characters) that will be shown when the user selects an incorrect answer.

Respond with a JSON object in the following format:
{
  "IncorrectAnswers": ["answer1", "answer2", "answer3"],
  "Explanation": "A short explanation or fun fact.",
  "ReformulatedQuestion": "The reformulated question."
}`,
				"json_object"
			);

			const parsedText = JSON.parse(response);
			const explanation = parsedText.Explanation.trim().slice(0, 200);
			const extractedURLFromQuestion = (questionDoc.Question.match(/href="([^"]+)"/) || [])[1];
			const answers = parsedText.IncorrectAnswers.map((answer) => answer.replace(/^"|"$/g, "").trim());
			questionDoc.IncorrectAnswers = answers;

			const question = {
				questionStr: questionDoc.Category + ": " + parsedText.ReformulatedQuestion.slice(0, 300),
				answer: questionDoc.Answer.replace(/^"|"$/g, "").trim(),
				hint: explanation,
				url: extractedURLFromQuestion,
				options: [questionDoc.Answer, ...questionDoc.IncorrectAnswers],
			};

			question.options = question.options.sort(() => Math.random() - 0.5).map((option) => option.replace(/^"|"$/g, "").trim());
			resolve(question);
		} catch (err) {
			console.error("Error processing DeepSeek response:", err);
			reject("deepseek_error");
		}
	});
}

module.exports = { sendRandomQuizz };
