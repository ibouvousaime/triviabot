const dotenv = require("dotenv");
dotenv.config("../.env");

const { Bot } = require("grammy");
const { sendRandomQuizz } = require("./trivia");
const MongoDB = require("./mongo");
const NodeCache = require("node-cache");
const schedule = require("node-schedule");
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

const timeToAnswer = 120;
const myCache = new NodeCache();
const pointsPerBonus = 1;
bot.command("start", async (ctx) => {
	const chatId = ctx.chat.id;
	const db = await MongoDB.getInstance().connect();
	if (ctx.chat.type === "private") {
		ctx.reply("This bot is not available in private chats. Please use it in a group chat.");
		return;
	} else if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
		const chat = await db.collection("chats").findOne({ chatId });
		if (!chat) {
			await db.collection("chats").insertOne({ chatId, chatName: ctx.chat.title, users: [] });
		}
	}
});

async function doTheWarning(chatId = null) {
	const db = await MongoDB.getInstance().connect();
	const chats = await db.collection("chats").find({}).toArray();

	for (const chat of chats) {
		if (chatId && chat.chatId !== chatId) continue;
		chat.users = chat.users || [];
		const warningMessage = await bot.api.sendMessage(
			chat.chatId,
			`${chat.users.map((user) => `@${user}`).join(" ")}⚠️ 5 minutes until the next quiz starts, bros! ⚠️`
		);
		await db.collection("chats").updateOne({ chatId: chat.chatId }, { $set: { users: [], warningMessageID: warningMessage.message_id } });
	}
}

async function doTriviaJob(chatId = null) {
	const db = await MongoDB.getInstance().connect();
	const chats = await db.collection("chats").find({}).toArray();
	for (const chat of chats) {
		if (chatId && chat.chatId !== chatId) continue;
		sendQuizz(chat.chatId);
		bot.api.deleteMessage(chat.chatId, chat.warningMessageID).catch((err) => {});
		/* setTimeout(() => {
			showLeaderboard(chat.chatId);
		}, timeToAnswer * 1000); */
	}
}

bot.command("warning", async (ctx) => {
	if (ctx.chat.title.includes("test")) {
		doTheWarning(ctx.chat.id);
	}
});

bot.command("trivia", async (ctx) => {
	if (ctx.chat.title.includes("test")) {
		doTriviaJob(ctx.chat.id);
	}
});

const warningJob = schedule.scheduleJob("55 2,5,8,11,14,17,20,23 * * *", () => {
	doTheWarning();
});

const job = schedule.scheduleJob("0 */3 * * *", () => {
	doTriviaJob();
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
		explanation: question.hint,
		correct_option_id: question.options.findIndex((option) => option === question.answer),
		//open_period: timeToAnswer,
		is_anonymous: false,
	});
	const db = await MongoDB.getInstance().connect();
	await db.collection("polls").insertOne({ ...pollMsg.poll, chatId, date: new Date() });
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
			const userGetsEarlyBonus = poll.date.getTime() + timeToAnswer * 1000 > new Date().getTime();
			let update = { first_name: userAnswer.user.first_name, last_name: userAnswer.user.last_name, username: userAnswer.user.username, chatId: poll.chatId };
			if (userAnswer.option_ids.includes(poll.correct_option_id)) {
				update = { $set: { ...update }, $inc: { correctAnswers: 1, bonus: userGetsEarlyBonus ? 1 : 0 } };
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
			{ $addFields: { score: { $add: ["$correctAnswers", { $multiply: [{ $ifNull: ["$bonus", 0] }, pointsPerBonus] }] } } },
			{ $sort: { score: -1 } },
			{ $limit: 10 },
		])
		.toArray();
	console.log(leaderboard);
	let message = `🏆 <b>Leaderboard</b> 🏆\n <i>1 point per correct answer + each bonus point for giving a quick answer awards ${pointsPerBonus} point.</i> \n\n`;
	for (let i = 0; i < leaderboard.length; i++) {
		const user = leaderboard[i];
		message +=
			`<b>${i + 1}.</b> ${user.first_name} ${user.last_name || ""} — <b>Score:</b> ${user.score || 0} ` +
			`(✅ Correct: ${user.correctAnswers || 0} | ⚡ Bonus: ${user.bonus || 0})\n`;
	}
	bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
}

bot.command("leaderboard", async (ctx) => {
	showLeaderboard(ctx.chat.id);
});

bot.command("warnme", async (ctx) => {
	const chatId = ctx.chat.id;
	const db = await MongoDB.getInstance().connect();
	if (ctx.chat.type === "private") {
		ctx.reply("Only in group chats, my friend! Please use it in a group chat.");
		return;
	} else if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
		const chat = await db.collection("chats").findOne({ chatId });
		if (chat) {
			chat.users = chat.users || [];
		}
		if (!chat.users.includes(ctx.from.username || ctx.from.first_name)) {
			await db.collection("chats").updateOne({ chatId }, { $push: { users: ctx.from.username || ctx.from.first_name } });
			ctx.reply("I'll @ you five minutes before the next quiz starts!");
		}
	}
});

bot.command("nowarn", async (ctx) => {
	const chatId = ctx.chat.id;
	const db = await MongoDB.getInstance().connect();
	if (ctx.chat.type === "private") {
		ctx.reply("Only in group chats, my friend! Please use it in a group chat.");
		return;
	} else if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
		const chat = await db.collection("chats").findOne({ chatId });
		if (chat) {
			chat.users = chat.users || [];
		}
		if (chat.users.includes(ctx.from.username || ctx.from.first_name)) {
			await db.collection("chats").updateOne({ chatId }, { $pull: { users: ctx.from.username || ctx.from.first_name } });
			ctx.reply("No more warnings for you, warm!");
		}
	}
});

bot.start();
bot.api.setMyCommands([
	{ command: "warnme", description: "get warning for next trivia" },
	{ command: "nowarn", description: "no longer get warning" },
	{ command: "leaderboard", description: "show leaderboard" },
]);
