import { APIGatewayProxyHandler } from 'aws-lambda';
import Slack from '@slack/bolt'
import { ChatGPTAPI } from "chatgpt";

const api = new ChatGPTAPI({
    apiKey: process.env.OPENAI_API_KEY!,
})

const awsLambdaReceiver = new Slack.AwsLambdaReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
});

const app = new Slack.App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver: awsLambdaReceiver,
});

app.event("app_mention", async ({ event, say }) => {
    const question = event.text.replace(/(?:\s)<@[^, ]*|(?:^)<@[^, ]*/, '');

    const ms = await say({
        channel: event.channel,
        text: ':thinking_face:',
    });

    await api.sendMessage(question, {
        onProgress: async (answer) => {
            await app.client.chat.update({
                channel: ms.channel!,
                ts: ms.ts!,
                text: answer.text,
            });
        }
    });
});

app.message("reset", async ({ message, say }) => {
    await say({
        channel: message.channel,
        text: 'I reset your session',
    });
});

app.message(async ({ message, say }) => {
    const isUserMessage = message.type === "message" && !message.subtype && !message.bot_id;

    if(isUserMessage && message.text && message.text !== "reset") {
        const { messages } = await app.client.conversations.history({
            channel: message.channel,
            latest: message.ts,
            inclusive: true,
            include_all_metadata: true,
            limit: 2
        });

        const previus = (messages || [])[1].metadata?.event_payload as any || {
            parentMessageId: undefined,
            conversationId: undefined
        };

        const ms = await say({
            channel: message.channel,
            text: ':thinking_face:',
        });


        try {
            const answer = await api.sendMessage(message.text, {
                parentMessageId: previus.parentMessageId,
                conversationId: previus.conversationId,
                onProgress: async (answer) => {
                    // Real-time update
                    await app.client.chat.update({
                        channel: ms.channel!,
                        ts: ms.ts!,
                        text: answer.text,
                        metadata: {
                            event_type: "chat_gpt",
                            event_payload: {
                                conversationId: answer.conversationId!,
                                parentMessageId: answer.parentMessageId!,
                            }
                        }
                    });
                }
            });

            await app.client.chat.update({
                channel: ms.channel!,
                ts: ms.ts!,
                text: answer.text,
                metadata: {
                    event_type: "chat_gpt",
                    event_payload: {
                        conversationId: answer.conversationId!,
                        parentMessageId: answer.parentMessageId!,
                    }
                }
            });
        } catch(error) {
            if(error instanceof Error) {
                await app.client.chat.update({
                    channel: ms.channel!,
                    ts: ms.ts!,
                    text: `:goose_warning: ${error.toString()}`
                });
            }
        }
    }
});

export const handler: APIGatewayProxyHandler = async (event, context, callback) => {
    if(event.headers['X-Slack-Retry-Num']) {
        return { statusCode: 200, body: "ok" }
    }
    const handler = await awsLambdaReceiver.start();

    return handler(event, context, callback);
}