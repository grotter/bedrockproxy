# AWS Bedrock Proxy

A proxy that provides an OpenAI-compatible API interface for AWS Bedrock's models. Originally developed for use as a model provider in Xcode via Intelligence [settings](https://developer.apple.com/documentation/Xcode/setting-up-coding-intelligence#Use-another-provider).

## Features

- **OpenAI-compatible API**: Drop-in replacement for OpenAI's chat completions API
- **Dynamic model discovery**: Automatically loads available models from AWS Bedrock inference profiles
- **Streaming support**: Real-time streaming responses using Server-Sent Events (SSE)
- **Authentication**: Secure API key-based authentication
- **Local development**: Built-in HTTP server for local testing
- **Multi-model support**: Access all available models through a unified API

## Prerequisites

- Node.js 18+ (for local development)
- AWS Account with Bedrock access
- AWS credentials configured

## Installation

```bash
# Clone the repository
git clone git@github.com:grotter/bedrockproxy.git
cd bedrockproxy

# Install dependencies
npm install
```

## Configuration

### Environment Variables

Create a `.env` file for local development (see `.env.template`):

```bash
API_KEY=your-secret-api-key-here
MODEL_ID=us.anthropic.claude-sonnet-4-6
PORT=3000
```

- **API_KEY**: Secret key for authenticating API requests
- **MODEL_ID**: Default Claude model to use (optional, defaults to Sonnet 4.6)
- **PORT**: Local server port (optional, defaults to 3000)

### Update Inference Profiles

To refresh the list of available models from AWS Bedrock:

```bash
aws bedrock list-inference-profiles --no-paginate > inference-profiles.json
```

## Local Development

Start the local development server:

```bash
npm start
```

The server will start at `http://localhost:3000` (or your configured PORT).

### Testing Endpoints

**List available models:**
```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Chat completion (non-streaming):**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "us.anthropic.claude-sonnet-4-6",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 256
  }'
```

**Chat completion (streaming):**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "us.anthropic.claude-sonnet-4-6",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 256,
    "stream": true
  }'
```

## API Reference

### Authentication

All requests require authentication using either:
- **Bearer token**: `Authorization: Bearer YOUR_API_KEY`
- **API key header**: `x-api-key: YOUR_API_KEY`

### Endpoints

#### GET /v1/models

Lists all available models

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "us.anthropic.claude-sonnet-4-6",
      "object": "model",
      "created": 1677610602,
      "owned_by": "anthropic"
    }
  ]
}
```

#### POST /v1/chat/completions

Creates a chat completion

**Request body:**
```json
{
  "model": "us.anthropic.claude-sonnet-4-6",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "max_tokens": 256,
  "stream": false
}
```

**Parameters:**
- `model` (string, optional): Model ID to use (defaults to MODEL_ID env var)
- `messages` (array, required): Array of message objects with `role` and `content`
- `max_tokens` (number, optional): Maximum tokens to generate (default: 256)
- `stream` (boolean, optional): Enable streaming responses (default: false)

## Troubleshooting

### Query string issues

The proxy automatically strips query strings from paths. Requests like `/v1/models?` will work correctly.

### Authentication errors

Ensure your API_KEY environment variable is set and matches the key in your requests.

### Model not found

Run `aws bedrock list-inference-profiles` to update your available models list.
