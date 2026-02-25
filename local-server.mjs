import http from "http";
import { Readable, PassThrough } from "stream";
import "dotenv/config";

// Mock the AWS Lambda streaming environment
global.awslambda = {
    streamifyResponse: (handler) => handler,
    HttpResponseStream: {
        from: (responseStream, { statusCode, headers }) => {
            responseStream._statusCode = statusCode;
            responseStream._headers = headers;
            return responseStream;
        }
    }
};

// Import the handler after setting up the mock
const { handler } = await import("./index.mjs");

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
    console.log(`${req.method} ${req.url}`);

    // Collect request body
    let body = "";
    for await (const chunk of req) {
        body += chunk;
    }

    // Create Lambda-compatible event object
    const event = {
        rawPath: req.url,
        path: req.url,
        headers: Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])
        ),
        body: body || undefined,
        requestContext: {
            http: {
                method: req.method
            }
        },
        httpMethod: req.method
    };

    // Create a response stream that captures status and headers
    const responseStream = new PassThrough();

    let statusCode = 200;
    let responseHeaders = {};

    // Override the mock to capture status and headers
    const originalFrom = global.awslambda.HttpResponseStream.from;
    global.awslambda.HttpResponseStream.from = (stream, { statusCode: sc, headers }) => {
        statusCode = sc;
        responseHeaders = headers;
        return originalFrom(stream, { statusCode: sc, headers });
    };

    // Call the handler
    try {
        const handlerPromise = handler(event, responseStream);

        // Wait a bit for headers to be set
        await new Promise(resolve => setImmediate(resolve));

        // Write headers
        res.writeHead(statusCode, responseHeaders);

        // Pipe the response stream to the HTTP response
        responseStream.pipe(res);

        // Wait for handler to complete
        await handlerPromise;
    } catch (error) {
        console.error("Handler error:", error);
        if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
        }
        if (!res.writableEnded) {
            res.end(JSON.stringify({ error: error.message }));
        }
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Local server running at http://localhost:${PORT}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  http://localhost:${PORT}/v1/models`);
    console.log(`  POST http://localhost:${PORT}/v1/chat/completions`);
});
