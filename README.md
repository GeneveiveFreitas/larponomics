# Kethercraft Stock Market

## Run locally

1. Install Node.js.
2. Create a MongoDB database (MongoDB Atlas or a self-hosted MongoDB server), create a database user, and allow the server's IP to connect.
3. Create a `.env` file with `MONGODB_URI` set to your MongoDB connection string. Optionally set `MONGODB_DB` to override the database name in the URI.
4. Keep `.env` private; never put the MongoDB connection string in browser code.
5. Run `npm.cmd install`, then `npm.cmd start` in PowerShell (or `npm install` and `npm start` in a shell where npm is available).
6. Open `http://localhost:3000`.

Mongoose manages the MongoDB connection and reads scheduled price changes from the `daily_moves` collection. The Express server only serves the page and its market data; the browser cannot connect directly to MongoDB with Mongoose.

The app reuses one Mongoose connection and the driver's default connection pool. Pool sizing is intentionally left at the driver default until the app's traffic and deployment are known. Once deployed, monitor MongoDB's current connection count and application request latency before changing pool settings.

## Deploy to Vercel

1. Push this project to a Git provider and import the repository into Vercel. The root `server.js` exports the Express app for Vercel's serverless runtime, and `public/` contains the static site files served by Vercel's CDN.
2. In the Vercel project's **Settings → Environment Variables**, add `MONGODB_URI`. Optionally add `MONGODB_DB` if you want to select a database name separately from the URI.
3. Make sure your MongoDB deployment permits connections from your Vercel deployment. Keep database credentials private; do not commit or upload `.env`.
4. Deploy or redeploy the project. Vercel runs the serverless function for `/api/market`; you do not run `npm start` on Vercel.

Use `vercel dev` to test the Vercel deployment locally if you have the Vercel CLI installed. `npm start` remains available for running the Express app locally.
