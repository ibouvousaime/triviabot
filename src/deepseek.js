const { OpenAI } = require("openai");
const dotenv = require("dotenv");
dotenv.config("../.env");

const openai = new OpenAI({
	baseURL: process.env.DEEPSEEK_BASE_URL,
	apiKey: process.env.DEEPSEEK_API_KEY,
});

function sendSimpleRequestToDeepSeek(message, format = undefined) {
	return new Promise(async (resolve, reject) => {
		const completion = await openai.chat.completions.create({
			model: "deepseek-reasoner",
			response_format: /* format ? { type: format } : */ undefined,
			messages: [{ role: "user", content: message }],
		});
		//response format is { data: { choices: [{ message: { content: "..." } }] } }
		resolve({ response: completion.choices[0].message.content, reasoning: completion.choices[0].message.reasoning_content });
	});
}

module.exports = { sendSimpleRequestToDeepSeek };
