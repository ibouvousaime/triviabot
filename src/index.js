const dotenv = require("dotenv");
dotenv.config("../.env");

const { Bot, API_CONSTANTS } = require("grammy");
const { sendRandomQuizz } = require("./trivia");
const MongoDB = require("./mongo");
const NodeCache = require("node-cache");
const schedule = require("node-schedule");
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

const timeToAnswer = 300;
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

async function doTriviaJob(chatId = null, waitingMessage = null) {
	return new Promise(async (resolve, reject) => {
		const db = await MongoDB.getInstance().connect();
		const chats = await db.collection("chats").find({}).toArray();
		for (const chat of chats) {
			if (chatId && chat.chatId !== chatId) {
				continue;
			}

			await sendQuizz(chat.chatId);
			if (waitingMessage) {
				await bot.api.deleteMessage(chat.chatId, waitingMessage.message_id).catch((err) => {});
			}
			//bot.api.deleteMessage(chat.chatId, chat.warningMessageID).catch((err) => {});

			/* setTimeout(() => {
			showLeaderboard(chat.chatId);
		}, timeToAnswer * 1000); */
		}
		resolve();
	});
}

bot.command("warning", async (ctx) => {
	if (ctx.chat.title.includes("test")) {
		doTheWarning(ctx.chat.id);
	}
});

bot.command("trivia", async (ctx) => {
	const allowedUsers = process.env.ALLOWED_USERS.split(" ");
	const isBusy = myCache.get(ctx.chat.id);
	if (!isBusy) {
		if (allowedUsers.includes(ctx.from.id.toString())) {
			myCache.set(ctx.chat.id, true);
			ctx.react("👍");
			//const waitingMessage = await ctx.reply("Just a sec~! I'm grabbing a trivia question for you~!\nIt's DeepSeek's fault I'm slow... hmph!");
			doTriviaJob(ctx.chat.id).then(() => {
				myCache.del(ctx.chat.id);
			});
		} else {
			const lastrejection = myCache.get(ctx.chat.id + "-rejection-");
			ctx.react("👎");
			if (lastrejection) {
				const timeSinceLastRejection = Date.now() - lastrejection;
				if (Date.now() - lastrejection < 10000) {
					return;
				}
			}

			myCache.set(ctx.chat.id + "-rejection-", Date.now());
			const rejectionMessage = await ctx.replyWithPhoto(process.env.NO_RESPONSE_LINK);
			setTimeout(() => {
				bot.api.deleteMessage(ctx.chat.id, rejectionMessage.message_id).catch((err) => {});
			}, 1500);
		}
	} else {
		ctx.react("😐");
	}
});

/* const warningJob = schedule.scheduleJob("55 2,5,8,11,14,17,20,23 * * *", () => {
	doTheWarning();
}); */

const job = schedule.scheduleJob("0 */3 * * *", () => {
	doTriviaJob();
});

function fetchURLContent(url) {
	return new Promise((resolve, reject) => {
		const https = require("https");
		https
			.get(url, (res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					resolve(data);
				});
			})
			.on("error", (err) => {
				reject(err);
			});
	});
}

async function sendQuizz(chatId) {
	return new Promise(async (resolve, reject) => {
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
		try {
			console.log("Question:", question);
			if (question.url) {
				let message;
				const fileExtension = question.url.split(".").pop().toLowerCase();
				if (["mp4", "mov", "avi", "mkv"].includes(fileExtension)) {
					message = bot.api.sendVideo(chatId, question.url).catch((err) => {
						console.error(err);
					});
				} else if (["jpg", "jpeg", "png", "gif", "bmp"].includes(fileExtension)) {
					message = bot.api.sendPhoto(chatId, question.url).catch((err) => {
						console.error(err);
					});
				}
			}
			const pollMsg = await bot.api.sendPoll(chatId, question.questionStr, question.options, {
				type: "quiz",
				explanation: question.hint,
				correct_option_id: question.options.findIndex((option) => option === question.answer),
				question_parse_mode: "HTML",
				//open_period: timeToAnswer,
				is_anonymous: false,
			});
			const db = await MongoDB.getInstance().connect();
			await db.collection("polls").insertOne({ ...pollMsg.poll, reasoning: question.reasoning, chatId, date: new Date() });
			resolve(pollMsg);
		} catch (error) {
			reject(error);
		}
	});
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

async function showLeaderboard(chatId, limited = true) {
	const db = await MongoDB.getInstance().connect();
	const leaderboard = await db
		.collection("pollScores")
		.aggregate([
			{ $match: { chatId } },
			{ $addFields: { deduction: { $floor: { $divide: [{ $add: ["$correctAnswers", "$wrongAnswers"] }, 15] } } } },
			{ $addFields: { ratio: { $divide: ["$correctAnswers", { $add: ["$correctAnswers", "$wrongAnswers"] }] } } },
			{ $addFields: { score: { $subtract: ["$correctAnswers", "$deduction"] } } },
			{ $sort: { score: -1 } },
			...(limited ? [{ $limit: 10 }] : []),
		])
		.toArray();
	let message = `🏆 <b>Leaderboard</b> 🏆\n <i>1 point per correct answer (a point deduced for every 15 answers) </i> \n\n`;
	for (let i = 0; i < leaderboard.length; i++) {
		const user = leaderboard[i];
		message +=
			`<b>${i + 1}.</b> ${user.first_name} ${user.last_name || ""} — <b>Score:</b> ${user.score || 0} ` +
			`(Correct: ${user.correctAnswers || 0} | Accuracy penalty: ${user.deduction || 0} | Ratio: ${Number.isFinite(user.ratio) ? user.ratio.toFixed(2) : 0})\n`;
	}
	bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
}

async function showLeaderboardRatio(chatId, limited = true) {
	const db = await MongoDB.getInstance().connect();
	const leaderboard = await db
		.collection("pollScores")
		.aggregate([
			{ $match: { chatId } },
			{
				$addFields: {
					totalAnswers: { $add: ["$correctAnswers", "$wrongAnswers"] },
				},
			},
			{
				$addFields: {
					accuracy: {
						$cond: [{ $eq: ["$totalAnswers", 0] }, 0, { $divide: ["$correctAnswers", "$totalAnswers"] }],
					},
				},
			},
			{
				$addFields: {
					score: { $multiply: ["$correctAnswers", "$accuracy"] },
				},
			},
			{ $sort: { score: -1 } },
			...(limited ? [{ $limit: 10 }] : []),
		])
		.toArray();

	let message = `🏆 <b>Leaderboard</b> 🏆\n <i>Score = correct × accuracy</i> \n\n`;
	for (let i = 0; i < leaderboard.length; i++) {
		const user = leaderboard[i];
		message +=
			`<b>${i + 1}.</b> ${user.first_name} ${user.last_name || ""} — <b>Score:</b> ${Math.round(user.score || 0)} ` +
			`(Correct: ${user.correctAnswers || 0} | Accuracy: ${Math.round(user.accuracy * 100 || 0)}%)\n`;
	}
	message = `<blockquote expandable>${message}\n\n---</blockquote>`;
	bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
}

bot.command("leaderboard", async (ctx) => {
	const lastLeaderboardPostTime = myCache.get(ctx.chat.id + "-leaderboard");
	if (lastLeaderboardPostTime && Date.now() - lastLeaderboardPostTime < 60000) {
		ctx.react("👎");
		return;
	}
	myCache.set(ctx.chat.id + "-leaderboard", Date.now());
	showLeaderboardRatio(ctx.chat.id, false);
});

bot.command("mystats", async (ctx) => {
	const db = await MongoDB.getInstance().connect();
	const chatId = ctx.chat.id;
	const stats = await db
		.collection("pollScores")
		.aggregate([
			{ $match: { chatId, userId: ctx.message.from.id } },
			{
				$addFields: {
					totalAnswers: { $add: ["$correctAnswers", "$wrongAnswers"] },
				},
			},
			{
				$addFields: {
					accuracy: {
						$cond: [{ $eq: ["$totalAnswers", 0] }, 0, { $divide: ["$correctAnswers", "$totalAnswers"] }],
					},
				},
			},
			{
				$addFields: {
					score: { $multiply: ["$correctAnswers", "$accuracy"] },
				},
			},
		])
		.toArray();
	const user = stats[0];
	const message =
		`<u>Stats for ${[ctx.message.from.first_name, ctx.message.from.last_name].join(" ").trim()}</u>\n` +
		`Correct: ${user.correctAnswers || 0}\n` +
		`Wrong: ${user.wrongAnswers || 0}\n` +
		`Score: ${Math.round(user.score || 0)}\n` +
		`Accuracy : ${Math.round((user.accuracy || 0) * 100)}%`;
	ctx.reply(message, { parse_mode: "HTML" });
});

/* bot.command("master", async (ctx) => {
	ctx.reply("@tgramtgramtgram");
});
 */

bot.start({ allowed_updates: API_CONSTANTS.ALL_UPDATE_TYPES });

bot.api.setMyCommands([
	{ command: "mystats", description: "personal stats" },
	{ command: "leaderboard", description: "show leaderboard" },
	{ command: "fullleaderboard", description: "show leaderboard without the limits" },
]);
