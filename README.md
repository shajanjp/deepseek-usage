# DeepSeek Usage Dashboard

A self-hosted dashboard for visualising your DeepSeek AI API usage — daily costs, token consumption, cache hit rates, and per-key breakdowns. Data is fetched directly from the [DeepSeek Platform API](https://platform.deepseek.com) and rendered client-side.

![Dashboard screenshot](assets/img/og-image.jpg)

## Features

- **Daily cost & token usage** — see how many tokens you're using (input, output, cached) and what it costs, day by day.
- **Cache hit rate tracking** — monitor how effectively your prompts hit the context cache.
- **Per-API-key breakdown** — compare usage across multiple API keys.
- **Drag & drop CSV import** — upload exported CSV files directly in the browser (works offline).
- **Live data from DeepSeek** — the backend proxies the DeepSeek API so you never expose your bearer token to the frontend.
- **Static HTML dashboard** — no build step, no framework, no JavaScript bundler. Just open and go.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A DeepSeek API bearer token from [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)
- `unzip` on your system (macOS / Linux — available by default)

## Quick Start

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/deepseek-usage.git
   cd deepseek-usage
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure your API token**

   Copy the example environment file and add your DeepSeek bearer token:

   ```bash
   cp .env.example .env
   ```

   Then edit `.env`:

   ```env
   DEEPSEEK_BEARER_TOKEN=sk-your-token-here
   # PORT=3000              # optional, defaults to 3000
   ```

4. **Start the server**

   ```bash
   npm run dev
   ```

   The server runs on `http://localhost:3000` by default. Use `npm start` for production (no file watching).

5. **Open the dashboard**

   Navigate to [http://localhost:3000](http://localhost:3000). The homepage gives you two ways to load data:

   - **Drag & drop** a CSV file (exported from DeepSeek) onto the page.
   - **Use the live API** buttons to fetch data directly from DeepSeek.

## API Endpoints

All endpoints are thin proxies to the DeepSeek REST API. No formatting or aggregation is done server-side — the frontend handles everything.

| Endpoint | Description |
|---|---|
| `GET /` | Serve the HTML dashboard |
| `GET /api/usage/export?month=&year=` | Raw CSV text from the usage export API |
| `GET /api/usage/summary` | Raw JSON from the user summary API |

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEEPSEEK_BEARER_TOKEN` | Yes | — | API token from [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| `PORT` | No | `3000` | Port for the web server |

## Usage

### Fetching data from DeepSeek

On the dashboard, click **"Fetch from DeepSeek API"** to pull the latest usage data directly. The server proxies the request — your bearer token never reaches the browser.

### Loading a CSV export

1. Go to [platform.deepseek.com/usage](https://platform.deepseek.com/usage) and export your usage as CSV.
2. Drag the CSV file onto the dashboard, or click the upload area to select it.
3. The dashboard parses and charts the data instantly.

## Development

Run the server with file watching (auto-restart on changes):

```bash
npm run dev
```

All logic lives in `index.html` (frontend) and `main.js` / `lib/` (backend). No bundler, no build step.

## License

[MIT](LICENSE)
