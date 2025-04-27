const { sendSimpleRequestToClaude } = require("./claude");
const MongoDB = require("./mongo");
function generateRandomString(length) {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let result = "";
	for (let i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	return result;
}

function sendRandomQuizz(chatId) {
	return new Promise(async (resolve, reject) => {
		const dbInstance = MongoDB.getInstance();
		await dbInstance.connect("messages");
		const db = dbInstance.getDb();
		const mongoCollection = db.collection("trivia");

		const questionDoc = (await mongoCollection.aggregate([{ $sample: { size: 1 } }]).toArray())[0];
		sendSimpleRequestToClaude(
			`You are a trivia expert. Given the following trivia question: "${questionDoc.Question}" and its correct answer: "${questionDoc.Answer}", generate three plausible, SHORT but incorrect answers. Ensure the incorrect answers are distinct, contextually relevant, and not overly similar to the correct answer while respecting the case. Reply with a JSON object in the format {"IncorrectAnswers": ["answer1", "answer2", "answer3"]}.`
		)
			.then(async (response) => {
				try {
					const answers = JSON.parse(response.content[0].text).IncorrectAnswers.map((answer) => answer.replace(/[^\w\s]/g, "").trim());
					questionDoc.IncorrectAnswers = answers;
					const question = {
						questionStr: questionDoc.Question,
						answer: questionDoc.Answer,
						options: [questionDoc.Answer, ...questionDoc.IncorrectAnswers],
					};
					question.options = question.options.sort(() => Math.random() - 0.5);
					resolve(question);
				} catch (err) {
					reject("claude_error");
				}
			})
			.catch((error) => {
				reject(error);
			});
	});
}

module.exports = { sendRandomQuizz };
