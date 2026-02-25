import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

const bedrock = new BedrockRuntimeClient({ region: "us-west-2" });
const VALID_API_KEY = process.env.API_KEY;
const MODEL_ID = process.env.MODEL_ID || "us.anthropic.claude-sonnet-4-6";

function httpStream(responseStream, statusCode, contentType) {
    return awslambda.HttpResponseStream.from(responseStream, {
        statusCode,
        headers: {
            "Content-Type": contentType,
            "Cache-Control": "no-cache",
        }
    });
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
    const headers = event.headers || {};
    const authHeader = headers["authorization"] || "";
    const xApiKey = headers["x-api-key"] || "";

    let providedKey = null;
    if (authHeader.startsWith("Bearer ")) {
        providedKey = authHeader.slice(7).trim();
    } else if (xApiKey) {
        providedKey = xApiKey.trim();
    }

    if (!providedKey || providedKey !== VALID_API_KEY) {
        responseStream = httpStream(responseStream, 401, "application/json");
        responseStream.write(JSON.stringify({ error: "Unauthorized" }));
        responseStream.end();
        return;
    }

    const path = event.rawPath || event.path || "";
    const httpMethod = event.requestContext?.http?.method || event.httpMethod || "";

    // console.log("Request:", JSON.stringify({ path, httpMethod, body: event.body }));

    // Handle /v1/models endpoint
    if ((path.endsWith("/v1/models") || path.endsWith("/models")) && httpMethod === "GET") {
        responseStream = httpStream(responseStream, 200, "application/json");

        // List of available Bedrock on-demand models
        const availableModels = [
            // Claude 4.6 models
            "us.anthropic.claude-opus-4-6",
            "us.anthropic.claude-sonnet-4-6",
            // Claude 4.5 models
            // "us.anthropic.claude-haiku-4-5-20251001",
            "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            // Claude 3.5 models
            "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
            "us.anthropic.claude-3-5-sonnet-20240620-v1:0",
            "us.anthropic.claude-3-5-haiku-20241022-v1:0",
            // Claude 3 models
            "us.anthropic.claude-3-opus-20240229-v1:0",
            "us.anthropic.claude-3-sonnet-20240229-v1:0",
            "us.anthropic.claude-3-haiku-20240307-v1:0",
        ];

        // aws bedrock list-inference-profiles --no-paginate > inference-profiles.json

        // Ensure MODEL_ID is first in the list (default model)
        const models = [MODEL_ID, ...availableModels.filter(m => m !== MODEL_ID)];

        const modelData = models.map((modelId, index) => ({
            id: modelId,
            object: "model",
            created: 1677610602 + index,
            owned_by: "anthropic"
        }));

        responseStream.write(JSON.stringify({
            object: "list",
            data: modelData
        }));

        responseStream.end();
        return;
    }

    // Chat Completions Handling
    let body;
    try {
        body = JSON.parse(event.body || "{}");
    } catch {
        responseStream = httpStream(responseStream, 400, "application/json");
        responseStream.write(JSON.stringify({ error: "Invalid JSON" }));
        responseStream.end();
        return;
    }

    const messages = body.messages || [];
    if (!messages.length) {
        responseStream = httpStream(responseStream, 400, "application/json");
        responseStream.write(JSON.stringify({ error: "messages field is required" }));
        responseStream.end();
        return;
    }

    // Extract system messages
    const systemMessages = messages.filter(m => m.role === "system");
    const nonSystemMessages = messages.filter(m => m.role !== "system");

    if (!nonSystemMessages.length) {
        responseStream = httpStream(responseStream, 400, "application/json");
        responseStream.write(JSON.stringify({ error: "At least one non-system message is required" }));
        responseStream.end();
        return;
    }

    const bedrockBody = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: body.max_tokens || 256,
        messages: nonSystemMessages
    };

    if (systemMessages.length) {
        bedrockBody.system = systemMessages.map(m => m.content || "").join(" ");
    }

    const isStreaming = body.stream === true;

    if (isStreaming) {
        responseStream = httpStream(responseStream, 200, "text/event-stream");

        const command = new InvokeModelWithResponseStreamCommand({
            modelId: MODEL_ID,
            body: JSON.stringify(bedrockBody),
            contentType: "application/json",
            accept: "application/json"
        });

        const response = await bedrock.send(command);

        const created = Math.floor(Date.now() / 1000);
        const requestModel = body.model || MODEL_ID;

        // Send role chunk (matching OpenAI's exact format)
        const roleChunk = JSON.stringify({
            id: "chatcmpl-bedrock",
            object: "chat.completion.chunk",
            created,
            model: requestModel,
            system_fingerprint: null,
            choices: [{ index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null }]
        });
        responseStream.write(`data: ${roleChunk}\n\n`);

        // Stream content chunks from Bedrock
        for await (const event of response.body) {
            if (event.chunk) {
                const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));

                if (chunk.type === "content_block_delta") {
                    const text = chunk.delta?.text || "";
                    if (text) {
                        const contentChunk = JSON.stringify({
                            id: "chatcmpl-bedrock",
                            object: "chat.completion.chunk",
                            created,
                            model: requestModel,
                            system_fingerprint: null,
                            choices: [{ index: 0, delta: { content: text }, logprobs: null, finish_reason: null }]
                        });
                        responseStream.write(`data: ${contentChunk}\n\n`);
                    }
                } else if (chunk.type === "message_stop") {
                    const stopChunk = JSON.stringify({
                        id: "chatcmpl-bedrock",
                        object: "chat.completion.chunk",
                        created,
                        model: requestModel,
                        system_fingerprint: null,
                        choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: "stop" }]
                    });
                    responseStream.write(`data: ${stopChunk}\n\n`);
                }
            }
        }

        responseStream.write("data: [DONE]\n\n");
        responseStream.end();
        return;
    }

    // Non-streaming response
    responseStream = httpStream(responseStream, 200, "application/json");

    const command = new InvokeModelCommand({
        modelId: MODEL_ID,
        body: JSON.stringify(bedrockBody),
        contentType: "application/json",
        accept: "application/json"
    });

    const response = await bedrock.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));

    responseStream.write(JSON.stringify({
        id: "chatcmpl-bedrock",
        object: "chat.completion",
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: result.content[0].text
            },
            finish_reason: "stop"
        }]
    }));
    responseStream.end();
});
