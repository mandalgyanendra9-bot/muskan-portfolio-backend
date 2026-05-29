const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const User = require("../models/User");
const { getProfilePhotoCandidate } = require("../utils/profilePhoto");

const legacyFields = ["profileImage", "profilePhoto", "avatar", "photoUrl", "googlePhoto", "image"];
const dryRun = process.argv.includes("--dry-run");

const isEmpty = (value) => value === undefined || value === null || String(value).trim() === "";

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  const cursor = User.find({
    $or: [
      { profilePhotoUrl: { $exists: false } },
      { profilePhotoUrl: null },
      { profilePhotoUrl: "" },
    ],
  })
    .select("_id profilePhotoUrl profileImage profilePhoto profilePhotoUrl avatar photoUrl googlePhoto image name email")
    .cursor();

  for await (const user of cursor) {
    scanned += 1;

    const existingPhoto = String(user.profilePhotoUrl || "").trim();
    if (existingPhoto) {
      skipped += 1;
      continue;
    }

    const candidate = getProfilePhotoCandidate(
      legacyFields.reduce((acc, field) => {
        acc[field] = user[field];
        return acc;
      }, {})
    );

    if (isEmpty(candidate)) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      updated += 1;
      continue;
    }

    const result = await User.updateOne(
      {
        _id: user._id,
        $or: [
          { profilePhotoUrl: { $exists: false } },
          { profilePhotoUrl: null },
          { profilePhotoUrl: "" },
        ],
      },
      { $set: { profilePhotoUrl: String(candidate).trim() } }
    );

    if (result.modifiedCount > 0) {
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        scanned,
        updated,
        skipped,
      },
      null,
      2
    )
  );
}

run()
  .catch((error) => {
    console.error("Backfill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
