const fs = require("fs");
const readline = require("readline");
const MongoDB = require("./src/mongo");
const { parse } = require("csv-parse");

async function readCSVFileLineByLine(filePath) {
	const csvOptions = {
		from_line: 2,
		skip_empty_lines: true,
		trim: true,
	};
	const readStream = fs.createReadStream(filePath);
	const parser = readStream.pipe(parse(csvOptions));

	let isFirstLine = true;
	let index = 0;
	for await (const record of parser) {
		if (isFirstLine) {
			isFirstLine = false;
			continue;
		}

		let index = 0;
		let db;

		try {
			db = await MongoDB.getInstance().connect();
			console.log("Database connected. Starting CSV processing...");

			for await (const record of parser) {
				const triviaQuestion = {
					Question: record[5],
					Answer: record[6],
					Category: record[3],
					Value: record[4],
				};

				await db.collection("jeopardy").insertOne(triviaQuestion);

				index++;
				if (index % 1000 === 0) {
					console.log(`Inserted ${index} records`);
				}
			}
			console.log(`Inserted ${index} records and done!`);
		} catch (err) {
			process.exit(1);
		} finally {
			if (!process.exitCode) {
				process.exit(0);
			}
		}
	}
	console.log(`Inserted ${index} records and done!`);
	process.exit(0);
}

readCSVFileLineByLine("./jeopardy.csv");
