const { sendSimpleRequestToClaude } = require("./claude");
const { sendSimpleRequestToDeepSeek } = require("./deepseek");
const MongoDB = require("./mongo");

function sendRandomQuizz(chatId) {
	return new Promise(async (resolve, reject) => {
		const dbInstance = MongoDB.getInstance();
		await dbInstance.connect("messages");
		const db = dbInstance.getDb();
		const mongoCollection = db.collection("jeopardy");

		const questionDoc = (await mongoCollection.aggregate([{ $sample: { size: 1 } }]).toArray())[0];
		questionDoc.Question = (questionDoc.Category ? questionDoc.Category + ": " : "") + questionDoc.Question;
		sendSimpleRequestToDeepSeek(
			`You are a trivia expert. Given the following trivia question: "${questionDoc.Question}" and its correct answer: "${questionDoc.Answer}", generate three plausible, SHORT but incorrect answers. Ensure the incorrect answers are distinct, contextually relevant, and not overly similar to the correct answer while respecting the case. Also provide a short explanation (up to 200 characters) that will be shown when the user fails, give them a fun fact for the explanation. Reply with a JSON object in the format {"IncorrectAnswers": ["answer1", "answer2", "answer3"], "Explanation": "explanation"}.`,
			"json_object"
		)
			.then(async (response) => {
				try {
					const parsedText = JSON.parse(response);
					const explanation = parsedText.Explanation.trim().slice(0, 200);
					const extractedURLFromQuestion = (questionDoc.Question.match(/href="([^"]+)"/) || [])[1];
					const answers = parsedText.IncorrectAnswers.map((answer) => answer.replace(/^"|"$/g, "").trim());
					questionDoc.IncorrectAnswers = answers;
					const question = {
						questionStr: questionDoc.Question.replace(/^"|"$/g, "").slice(0, 300),
						answer: questionDoc.Answer.replace(/[^\w\s]/g, "")
							.replace(/^"|"$/g, "")
							.trim(),
						hint: explanation,
						url: extractedURLFromQuestion,
						options: [questionDoc.Answer, ...questionDoc.IncorrectAnswers],
					};
					question.options = question.options.sort(() => Math.random() - 0.5).map((option) => option.replace(/^"|"$/g, "").replace(/^"|"$/g, "").trim());
					resolve(question);
				} catch (err) {
					console.log(err);
					reject("claude_error");
				}
			})
			.catch((error) => {
				reject(error);
			});
	});
}

module.exports = { sendRandomQuizz };
