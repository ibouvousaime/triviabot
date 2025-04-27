const dotenv = require("dotenv");
dotenv.config("../.env");

const { Bot } = require("grammy");
const { sendRandomQuizz } = require("./trivia");
const MongoDB = require("./mongo");
const NodeCache = require("node-cache");

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

const timeToAnswer = 30;
const myCache = new NodeCache();
bot.command("trivia", async (ctx) => {
	const chatId = ctx.chat.id;
	const lastUsedKey = `lastUsed-${chatId}`;
	const lastUsed = myCache.get(lastUsedKey);
	const cooldown = 10000;
	if (lastUsed && Date.now() - lastUsed < cooldown) {
		const remainingTime = Math.ceil((cooldown - (Date.now() - lastUsed)) / 1000);
		ctx.reply(`Please wait ${remainingTime} seconds before the trivia is ready again.`);
		return;
	} else {
		let question;
		let attempts = 0;
		const maxAttempts = 3;

		while (attempts < maxAttempts) {
			try {
				question = await sendRandomQuizz(ctx.chat.id);
				if (question) break;
			} catch (error) {
				console.error(`Attempt ${attempts + 1} failed:`, error);
			}
			attempts++;
		}

		if (!question) {
			ctx.reply("Failed to fetch a trivia question. Please try again later.");
			return;
		}
		const pollMsg = await ctx.replyWithPoll(question.questionStr, question.options, {
			type: "quiz",
			correct_option_id: question.options.findIndex((option) => option === question.answer),
			open_period: timeToAnswer,
			is_anonymous: false,
		});
		const db = await MongoDB.getInstance().connect();
		await db.collection("polls").insertOne({ ...pollMsg.poll, chatId: ctx.chat.id });
		myCache.set(lastUsedKey, Date.now(), cooldown / 1000);
		return;
	}
});

bot.on("poll_answer", async (ctx) => {
	const db = await MongoDB.getInstance().connect();

	const userAnswer = ctx.update.poll_answer;
	db.collection("polls")
		.findOne({ id: userAnswer.poll_id })
		.then((poll) => {
			if (!poll) {
				return;
			}
			let update = { first_name: userAnswer.user.first_name, last_name: userAnswer.user.last_name, username: userAnswer.user.username, chatId: poll.chatId };
			if (userAnswer.option_ids.includes(poll.correct_option_id)) {
				update = { $set: { ...update }, $inc: { correctAnswers: 1 } };
			} else {
				update = { $set: { ...update }, $inc: { wrongAnswers: 1 } };
			}
			db.collection("pollScores").updateOne({ userId: userAnswer.user.id, chatId: poll.chatId }, update, { upsert: true });
		});
});

bot.command("leaderboard", async (ctx) => {
	const db = await MongoDB.getInstance().connect();
	const leaderboard = await db
		.collection("pollScores")
		.aggregate([
			{ $match: { chatId: ctx.chat.id } },
			{ $addFields: { ratio: { $divide: ["$correctAnswers", { $add: ["$correctAnswers", "$wrongAnswers"] }] } } },
			{ $sort: { ratio: -1 } },
			{ $limit: 10 },
		])
		.toArray();

	if (leaderboard.length === 0) {
		ctx.reply("No scores available yet.");
		return;
	}
	let message = "Leaderboard:\n";
	for (let i = 0; i < leaderboard.length; i++) {
		message += `<b>${i + 1}.</b> ${leaderboard[i].first_name} ${leaderboard[i].last_name ? leaderboard[i].last_name : ""} - <b>Score:</b> ${
			leaderboard[i].ratio.toFixed(2) || 0
		}\n`;
	}
	ctx.reply(message, { parse_mode: "HTML" });
});

bot.api.setMyCommands([
	{ command: "trivia", description: "Get a trivia question" },
	{ command: "leaderboard", description: "Get the leaderboard" },
]);

bot.start();
