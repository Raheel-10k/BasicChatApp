import { Server as SocketIOServer } from "socket.io";
import Message from "./model/MessagesModel.js";
import Channel from "./model/ChannelModel.js";
import cron from "node-cron";

const setupSocket = (server) => {
    const io = new SocketIOServer(server, {
        cors: {
            origin: process.env.ORIGIN,
            methods: ["GET", "POST"],
            credentials: true,
        },
    });

    const userSocketMap = new Map();
    const scheduledMessages = new Map();

    const addChannelNotify = async (channel) => {
        if (channel && channel.members) {
            channel.members.forEach((member) => {
                const memberSocketId = userSocketMap.get(member.toString());
                if (memberSocketId) {
                    io.to(memberSocketId).emit("new-channel-added", channel);
                }
            });
        }
    };

    const sendMessage = async (message) => {
        const recipientSocketId = userSocketMap.get(
            message.recipient.toString()
        );
        const senderSocketId = userSocketMap.get(message.sender.toString());

        const createdMessage = await Message.create(message);

        const messageData = await Message.findById(createdMessage._id)
            .populate("sender", "id email firstName lastName image color")
            .populate("recipient", "id email firstName lastName image color")
            .exec();

        if (recipientSocketId) {
            io.to(recipientSocketId).emit("receiveMessage", messageData);
        }
        if (senderSocketId) {
            io.to(senderSocketId).emit("receiveMessage", messageData);
        }
    };

    const sendChannelMessage = async (message) => {
        const { channelId, sender, content, messageType, fileUrl } = message;

        const createdMessage = await Message.create({
            sender,
            recipient: null,
            content,
            messageType,
            timestamp: new Date(),
            fileUrl,
        });

        const messageData = await Message.findById(createdMessage._id)
            .populate("sender", "id email firstName lastName image color")
            .exec();

        await Channel.findByIdAndUpdate(channelId, {
            $push: { messages: createdMessage._id },
        });

        const channel = await Channel.findById(channelId).populate("members");

        const finalData = { ...messageData._doc, channelId: channel._id };
        if (channel && channel.members) {
            channel.members.forEach((member) => {
                const memberSocketId = userSocketMap.get(member._id.toString());
                if (memberSocketId) {
                    io.to(memberSocketId).emit(
                        "receive-channel-message",
                        finalData
                    );
                }
            });
            const adminSocketId = userSocketMap.get(
                channel.admin._id.toString()
            );
            if (adminSocketId) {
                io.to(adminSocketId).emit("receive-channel-message", finalData);
            }
        }
    };

    const scheduleMessage = async (message, scheduleDate) => {
        if (!(scheduleDate instanceof Date) || isNaN(scheduleDate.getTime())) {
            throw new TypeError("scheduleDate must be a valid Date object!");
        }

        const scheduleTimestamp = scheduleDate.getTime();
        const jobId = `message_${Date.now()}`;
        const scheduledMessage = await Message.create({
            ...message,
            isScheduled: true,
            scheduledTime: scheduleDate,
        });

        const scheduledJob = cron.schedule("* * * * * *", async () => {
            const currentTime = Date.now();
            console.log(
                scheduleTimestamp,
                " ",
                currentTime,
                " ",
                scheduleTimestamp <= currentTime
            );
            if (scheduleTimestamp <= currentTime) {
                console.log("Sending scheduled message");

                const messageToSend = await Message.findById(
                    scheduledMessage._id
                );

                await sendMessage(messageToSend);

                scheduledJob.stop();
                scheduledMessages.delete(jobId);
                console.log("Sent scheduled message");
            }
        });

        scheduledMessages.set(jobId, scheduledJob);
        console.log("Scheduled message job created");
    };

    const convertDateToCron = (date) => {
        const minutes = date.getUTCMinutes();
        const hours = date.getUTCHours();
        const dayOfMonth = date.getUTCDate();
        const month = date.getUTCMonth() + 1;
        const dayOfWeek = date.getUTCDay();

        return `${minutes} ${hours} ${dayOfMonth} ${month} ${dayOfWeek}`;
    };

    const disconnect = (socket) => {
        console.log("Client disconnected", socket.id);
        for (const [userId, socketId] of userSocketMap.entries()) {
            if (socketId === socket.id) {
                userSocketMap.delete(userId);
                break;
            }
        }
    };

    io.on("connection", (socket) => {
        const userId = socket.handshake.query.userId;

        if (userId) {
            userSocketMap.set(userId, socket.id);
            console.log(
                `User connected: ${userId} with socket ID: ${socket.id}`
            );
        } else {
            console.log("User ID not provided during connection.");
        }

        socket.on("add-channel-notify", addChannelNotify);

        socket.on("sendMessage", sendMessage);

        socket.on("send-channel-message", sendChannelMessage);

        socket.on("scheduleMessage", async (data) => {
            const { scheduleTime, ...message } = data;
            const scheduleDate = new Date(scheduleTime);
            await scheduleMessage(message, scheduleDate);
        });

        socket.on("schedule-channel-message", async (data) => {
            const { scheduleTime, ...message } = data;
            const scheduleDate = new Date(scheduleTime);
            await scheduleMessage(message, scheduleDate);
        });

        socket.on("disconnect", () => disconnect(socket));
    });
};

export default setupSocket;
