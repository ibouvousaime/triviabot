const Anthropic = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({});

async function sendSimpleRequestToClaude(message) {
	const output = await anthropic.messages.create({
		max_tokens: 1024,
		messages: [{ role: "user", content: message }],
		model: "claude-3-7-sonnet-20250219",
	});
	console.log(output);
	return { response: output.content[0].text };
}

module.exports = { sendSimpleRequestToClaude };
