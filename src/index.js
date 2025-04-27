const dotenv = require("dotenv");
dotenv.config("../.env");

const { Bot } = require("grammy");
const { sendRandomQuizz } = require("./trivia");
const MongoDB = require("./mongo");
const NodeCache = require("node-cache");
const schedule = require("node-schedule");
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

const timeToAnswer = 20;
const myCache = new NodeCache();

bot.command("start", async (ctx) => {
	const chatId = ctx.chat.id;
	const db = await MongoDB.getInstance().connect();
	if (ctx.chat.type === "private") {
		ctx.reply("This bot is not available in private chats. Please use it in a group chat.");
		return;
	} else if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
		const chat = await db.collection("chats").findOne({ chatId });
		if (!chat) {
			await db.collection("chats").insertOne({ chatId, chatName: ctx.chat.title });
		}
	}
});

const job = schedule.scheduleJob("0 */6 * * *", async () => {
	const db = await MongoDB.getInstance().connect();
	const chats = await db.collection("chats").find({}).toArray();
	for (const chat of chats) {
		sendQuizz(chat.chatId);
		setTimeout(() => {
			showLeaderboard(chat.chatId);
		}, timeToAnswer * 1000);
	}
});
async function sendQuizz(chatId) {
	let question;
	let attempts = 0;
	const maxAttempts = 3;

	while (attempts < maxAttempts) {
		try {
			question = await sendRandomQuizz(chatId);
			if (question) break;
		} catch (error) {
			console.error(`Attempt ${attempts + 1} failed:`, error);
		}
		attempts++;
	}

	const pollMsg = await bot.api.sendPoll(chatId, question.questionStr, question.options, {
		type: "quiz",
		correct_option_id: question.options.findIndex((option) => option === question.answer),
		open_period: timeToAnswer,
		is_anonymous: false,
	});
	const db = await MongoDB.getInstance().connect();
	await db.collection("polls").insertOne({ ...pollMsg.poll, chatId });
	return;
}

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

async function showLeaderboard(chatId) {
	const db = await MongoDB.getInstance().connect();
	const leaderboard = await db
		.collection("pollScores")
		.aggregate([
			{ $match: { chatId } },
			{ $addFields: { ratio: { $divide: ["$correctAnswers", { $add: ["$correctAnswers", "$wrongAnswers"] }] } } },
			{ $sort: { correctAnswers: -1 } },
			{ $limit: 10 },
		])
		.toArray();
	let message = "Leaderboard:\n";
	for (let i = 0; i < leaderboard.length; i++) {
		message += `<b>${i + 1}.</b> ${leaderboard[i].first_name} ${leaderboard[i].last_name ? leaderboard[i].last_name : ""} - <b>Score:</b> ${
			leaderboard[i].correctAnswers || 0
		}\n`;
	}
	bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
}

bot.api.setMyCommands([]);

bot.start();
