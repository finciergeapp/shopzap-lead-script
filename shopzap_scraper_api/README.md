# Shopzap Scraper API – Railway Deploy Pack

A ready-to-deploy **Playwright + Node.js** microservice for scraping competitor product data (price, stock, title) and serving it via a simple REST API. Optimized for **Render** deployment.

## Use Case

Power the MVP for **shopzap.io – Competitor Watcher & Price Alert Bot**. Start cheap, scale later.

## Features

-   **Multi-Site Scraping**: Automatically detects Amazon, Flipkart, and Myntra URLs and applies specific scraping logic.
-   **Price History Tracking**: Integrates a local database (`lowdb`) to store and retrieve the last 5 price changes for each product.
-   **Stock Alerts**: Sends notifications to a configured webhook URL when a product changes from 'Out of Stock' to 'In Stock'.
-   **Bulk Scraping**: Provides an endpoint to scrape multiple URLs in a single request.
-   **Proxy Rotation + Anti-Bot Bypass**: Integrates proxy rotation for requests to avoid blocking, using a pool of proxies from environment variables.
-   **REST API**: Provides simple API endpoints to trigger scraping and retrieve data, including price history.
-   **Dockerized**: Ready for containerized deployment.
-   **Render Optimized**: Ready for easy deployment on Render.

## Getting Started

### Prerequisites

-   Node.js (v18 or higher)
-   npm (Node Package Manager)
-   Docker (optional, for local containerization)
-   A webhook URL for stock alerts (e.g., Discord, Slack, or a custom endpoint)
-   A list of proxies (optional, for proxy rotation)
-   An API Key for authentication (e.g., `test-key-123`, `pro-user-456`)

### Local Setup

1.  **Clone the repository (or create the files manually as instructed by the AI)**:

    ```bash
    git clone <repository-url>
    cd shopzap_scraper_api
    ```

2.  **Install dependencies**:

    ```bash
    npm install
    ```

3.  **Create a `.env` file** in the root directory and add your environment variables. For example:

    ```
    PORT=3000
    WEBHOOK_URL=https://your-webhook-url.com/  # Optional: for stock alerts
    PROXY_LIST=http://user:pass@host:port,http://user2:pass2@host2:port2 # Optional: comma-separated list of proxies
    API_KEYS=test-key-123,pro-user-456 # Comma-separated list of valid API keys
    ```

4.  **Run the application**:

    ```bash
    npm start
    ```

    The API will be running at `http://localhost:3000` (or your specified PORT).

### API Usage

#### `GET /`

Returns a simple message indicating the API is running.

#### `POST /scrape`

Scrapes product data from a given URL. Automatically detects Amazon, Flipkart, and Myntra. For other sites, a `selector` is required.

-   **Authentication**: Requires an API key in the `x-api-key` header.
-   **Rate Limit**: 20 requests per minute per IP.
-   **Method**: `POST`
-   **URL**: `/scrape`
-   **Headers**: `Content-Type: application/json`, `x-api-key: YOUR_API_KEY`
-   **Body**:

    ```json
    // For Amazon, Flipkart, Myntra (selector is optional)
    {
        "url": "https://www.amazon.in/dp/B08XYZ123"
    }

    // For other sites (selector is required)
    {
        "url": "https://example.com/product/123",
        "selector": ".product-title"
    }
    ```

-   **Success Response** (200 OK):

    ```json
    {
        "title": "Product Title",
        "raw_price": "$19.99",
        "numeric_price": 19.99,
        "stock": "In Stock",
        "seller": "Example Seller",
        "url": "https://example.com/product/123",
        "priceHistory": [
            { "price": 19.99, "stock": "In Stock", "timestamp": "2023-10-27T10:00:00.000Z" },
            { "price": 20.50, "stock": "Out of Stock", "timestamp": "2023-10-26T10:00:00.000Z" }
        ]
    }
    ```

-   **Error Responses**:
    -   `400 Bad Request`: If `url` is missing, or `selector` is missing for non-supported sites.
-   `401 Unauthorized`: If `x-api-key` header is missing.
-   `403 Forbidden`: If `x-api-key` is invalid.
-   `429 Too Many Requests`: If rate limit is exceeded.
-   `404 Not Found`: If the element(s) specified by the scraper or selector are not found.
-   `500 Internal Server Error`: For other scraping failures (e.g., proxy issues, Playwright errors).

## Deployment on Render

This project is optimized for deployment on [Render](https://render.com/).

1.  **Create a new Web Service on Render**.
2.  **Connect your GitHub repository** (if you cloned this project) or deploy directly from a Dockerfile.
3.  Render will automatically detect your `Dockerfile` and deploy your application.
4.  Ensure any necessary environment variables (like `PORT`, `WEBHOOK_URL`, `PROXY_LIST`, `API_KEYS`) are configured in Render's environment variables section for your service.

## Project Structure

```
.env
.dockerignore
Dockerfile

render.yaml
db.json
index.js
package.json
package-lock.json
README.md
```

### Scheduled Scraping (Cron Jobs)

#### `POST /schedule`

Schedules a product scraping task to run at a specified frequency using cron syntax.

-   **Method**: `POST`
-   **URL**: `/schedule`
-   **Headers**: `Content-Type: application/json`
-   **Body**:

    ```json
    {
        "url": "https://www.amazon.in/dp/B08XYZ123",
        "selector": null, // Optional: required for non-supported sites
        "frequency": "0 */6 * * *" // Cron string (e.g., every 6 hours)
    }
    ```

-   **Success Response** (201 Created):

    ```json
    {
        "message": "Task scheduled successfully",
        "taskId": "<generated-task-id>"
    }
    ```

-   **Error Responses**:
    -   `400 Bad Request`: If `url` or `frequency` is missing, or `frequency` is an invalid cron format.

#### `GET /schedules`

Retrieves a list of all currently scheduled scraping tasks.

-   **Method**: `GET`
-   **URL**: `/schedules`
-   **Success Response** (200 OK):

    ```json
    [
        {
            "id": "<task-id-1>",
            "url": "https://www.amazon.in/dp/B08XYZ123",
            "selector": null,
            "frequency": "0 */6 * * *"
        },
        {
            "id": "<task-id-2>",
            "url": "https://example.com/product/456",
            "selector": ".product-name",
            "frequency": "0 0 * * *" // Every day at midnight
        }
    ]
    ```

#### `DELETE /schedule/:id`

Removes a scheduled scraping task by its ID.

-   **Method**: `DELETE`
-   **URL**: `/schedule/:id` (replace `:id` with the actual task ID)
-   **Success Response** (200 OK):

    ```json
    {
        "message": "Task unscheduled successfully",
        "taskId": "<deleted-task-id>"
    }
    ```

-   **Error Response**:
    -   `404 Not Found`: If the `taskId` does not exist.

### Search by Keyword (Optional)

#### `GET /search`

Performs a product search on a specified site and returns the top 5 results.

-   **Method**: `GET`
-   **URL**: `/search`
-   **Query Parameters**:
    -   `site`: The name of the site to search on (e.g., `amazon`, `flipkart`, `myntra`).
    -   `keyword`: The search term.

-   **Example Usage**:

    ```
    GET /search?site=amazon&keyword=laptop
    ```

-   **Success Response** (200 OK):

    ```json
    [
        {
            "title": "Product 1 Title",
            "raw_price": "₹42,999",
            "numeric_price": 42999,
            "stock": "In Stock",
            "url": "https://www.amazon.in/product/1"
        },
        {
            "title": "Product 2 Title",
            "raw_price": "₹1,299",
            "numeric_price": 1299,
            "stock": "Currently unavailable",
            "url": "https://www.amazon.in/product/2"
        }
    ]
    ```

-   **Error Responses**:
    -   `400 Bad Request`: If `site` or `keyword` is missing, or the `site` is not supported.
    -   `404 Not Found`: If no products are found for the given keyword on the specified site.
    -   `500 Internal Server Error`: For other search failures.

### Bulk Scraping

#### `POST /bulk-scrape`

Scrapes data for an array of URLs. Each item in the array can be a string (URL) or an object `{ url, selector }`.

-   **Method**: `POST`
-   **URL**: `/bulk-scrape`
-   **Headers**: `Content-Type: application/json`
-   **Body**:

    ```json
    [
        "https://www.amazon.in/dp/B08XYZ123",
        {
            "url": "https://example.com/product/456",
            "selector": ".product-name"
        }
    ]
    ```

-   **Success Response** (200 OK):

    Returns an array of results, each in the same format as the `/scrape` endpoint's success response. If an error occurs for a specific URL, its entry in the array will contain an `error` field.

    ```json
    [
        {
            "title": "Product 1",
            "price": "$10.00",
            "stock": "In Stock",
            "url": "https://www.amazon.in/dp/B08XYZ123",
            "priceHistory": []
        },
        {
            "url": "https://example.com/product/456",
            "error": "Could not scrape data. Element(s) not found."
        }
    ]
    ```

## Contributing

Feel free to fork the repository, open issues, or submit pull requests.

## License

This project is licensed under the ISC License.