const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config("../.env");
class MongoDB {
	constructor() {
		this.client = null;
		this.db = null;
	}

	static getInstance() {
		if (!MongoDB.instance) {
			MongoDB.instance = new MongoDB();
		}
		return MongoDB.instance;
	}

	async connect(dbName = "messages") {
		if (!this.client) {
			this.client = new MongoClient(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
			await this.client.connect();
			this.db = this.client.db(dbName);
			console.log(`Connected to database`);
		}
		return this.db;
	}

	getDb() {
		if (!this.db) {
			throw new Error("Database not connected. Call connect() first.");
		}
		return this.db;
	}

	async close() {
		if (this.client) {
			await this.client.close();
			this.client = null;
			this.db = null;
		}
	}
}

module.exports = MongoDB;
