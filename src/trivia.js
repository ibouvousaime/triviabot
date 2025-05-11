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
			await mongoCollection.aggregate([/* { $match: { Question: { $regex: "kamelos", $options: "i" } } }, */ { $sample: { size: 1 } }]).toArray()
		)[0];
		try {
			const prompt = `You are a trivia expert AI creating engaging quiz questions. Given:
			- Question: "${questionDoc.Question}"
			- Category: '${questionDoc.Category}'
			- Correct answer: "${questionDoc.Answer}"

			Tasks:
			1. Reformulate the question: Make it engaging, clear, appropriate difficulty, and concise (max 150 chars)
				- If question reveals answer (even in different language), create a new question with same answer
				- Ensure it works well in multiple-choice format

			2. Generate three incorrect answers that:
				- Match format, style, and length of correct answer
				- Are plausible but clearly incorrect
				- Follow any special formatting of correct answer

			3. Create brief explanation (max 200 chars):
				- Why correct answer is right
				- Include interesting fact
				- Be educational and engaging

			Output JSON only:
			{
				 "Reasoning": "Your summarized reasoning behind the reformulated question and answer choices",
				 "IncorrectAnswers": ["answer1", "answer2", "answer3"],
				 "Explanation": "Your concise explanation",
				 "ReformulatedQuestion": "Your reformulated question"
			}
				 
			Make sure the JSON is valid and well-formed. Do not include any other text or formatting.`;

			const response = await sendSimpleRequestToDeepSeek(prompt, "json_object");

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
