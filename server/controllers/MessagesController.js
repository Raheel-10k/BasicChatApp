import Message from "../model/MessagesModel.js";
import CryptoJS from "crypto-js";
import dotenv from "dotenv";
dotenv.config();

const secretKey = process.env.MY_SECRET_KEY || "New keys";

export const getMessages = async (req, res, next) => {
    try {
        const user1 = req.userId;
        const user2 = req.body.id;
        if (!user1 || !user2) {
            return res.status(400).send("Both user IDs are required.");
        }

        let messages = await Message.find({
            $or: [
                { sender: user1, recipient: user2 },
                { sender: user2, recipient: user1 },
            ],
        }).sort({ timestamp: 1 });

        // Decrypt the content of each message
        messages = messages.map((message) => {
            if (message.content) {
                try {
                    const bytes = CryptoJS.AES.decrypt(
                        message.content,
                        secretKey
                    );
                    const decryptedMessage = bytes.toString(CryptoJS.enc.Utf8);
                    message.content = decryptedMessage;
                } catch (err) {
                    console.error(
                        "Decryption failed for message:",
                        message._id,
                        err
                    );
                }
            }
            return message;
        });

        return res.status(200).json({ messages });
    } catch (err) {
        console.log(err);
        return res.status(500).send("Internal Server Error");
    }
};

export const uploadFile = async (request, response, next) => {
    try {
        if (request.file) {
            const date = Date.now();
            let fileDir = `uploads/files/${date}`;
            let fileName = `${fileDir}/${request.file.originalname}`;

            mkdirSync(fileDir, { recursive: true });

            renameSync(request.file.path, fileName);
            return response.status(200).json({ filePath: fileName });
        } else {
            return response.status(404).send("File is required.");
        }
    } catch (error) {
        console.log({ error });
        return response.status(500).send("Internal Server Error.");
    }
};
