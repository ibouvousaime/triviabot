const { sendSimpleRequestToClaude } = require("./claude");
const { sendSimpleRequestToDeepSeek } = require("./deepseek");
const MongoDB = require("./mongo");

function sendRandomQuizz(chatId) {
	return new Promise(async (resolve, reject) => {
		const dbInstance = MongoDB.getInstance();
		await dbInstance.connect("messages");
		const db = dbInstance.getDb();
		const mongoCollection = db.collection(Math.random() > 0.5 ? "trivia" : "jeopardy");

		const questionDoc = (
			await mongoCollection
				.aggregate([/* { $match: { Category: { $regex: "prime", $options: "i" }, Answer: { $regex: "911", $options: "i" } } }, */ { $sample: { size: 1 } }])
				.toArray()
		)[0];
		try {
			const prompt = `You are a trivia expert AI creating engaging quiz questions. Given:
			- Question: "${questionDoc.Question}"
			- Category: '${questionDoc.Category || "General Knowledge"}'
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
				 "Answer": "The correct answer (in the same format/style as the wrong answers)",
				 "Question: "The same exact question minus anything that could make it easy or reveal the answer."
			}
				 
			Make sure the JSON is valid and well-formed. Do not include any other text or formatting.`;

			const { response, reasoning } = await sendSimpleRequestToClaude(prompt);

			const parsedText = JSON.parse(response);
			const explanation = parsedText.Explanation.trim().slice(0, 200);
			const extractedURLFromQuestion = (questionDoc.Question.match(/href="([^"]+)"/) || [])[1];
			const answers = parsedText.IncorrectAnswers.map((answer) => answer.replace(/^"|"$/g, "").trim());
			questionDoc.IncorrectAnswers = answers;
			const question = {
				questionStr: (questionDoc.Category ? questionDoc.Category + ": " : "") + parsedText.Question.slice(0, 300),
				answer: parsedText.Answer.replace(/^"|"$/g, "").trim(),
				hint: explanation,
				url: extractedURLFromQuestion,
				options: [parsedText.Answer, ...questionDoc.IncorrectAnswers],
				reasoning: parsedText.Reasoning,
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
