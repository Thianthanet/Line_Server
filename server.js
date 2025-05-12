const express = require("express");
const app = express();
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const multer = require("multer");
const { PrismaClient } = require("@prisma/client");
const favicon = require("serve-favicon");
const cloudinary = require("cloudinary").v2;
const bodyParser = require('body-parser');
const line = require('@line/bot-sdk');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
}

const lineClient = new line.Client(lineConfig)

const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// ใช้ favicon ถ้ามี
app.use(favicon(path.join(__dirname, "public", "favicon.ico")));

// ✅ ใช้ /tmp/uploads แทน uploads/
const tempUploadDir = "/tmp/uploads";
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const upload = multer({ dest: tempUploadDir });

app.get("/", (req, res) => {
  try {
    res.json({ message: "API Created by Thianthanet" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text.trim();
        const userId = event.source.userId;

        if (/^[0-9]{10}$/.test(userMessage)) {
          try {
            const user = await prisma.user.findFirst({
              where: { phone: userMessage }
            });

            if (user) {
              await lineClient.replyMessage(event.replyToken, {
                type: 'text',
                text: '✅ ลงทะเบียนสำเร็จ! ขอบคุณที่ใช้บริการของเรา'
              });
              
              if (!user.userId) {
                await prisma.user.update({
                  where: { id: user.id },
                  data: { userId }
                });
              }
            } else {
              await lineClient.replyMessage(event.replyToken, {
                type: 'text',
                text: `❌ ไม่พบหมายเลขโทรศัพท์นี้ในระบบ\nกรุณาติดต่อเจ้าหน้าที่ที่หมายเลข 02-XXX-XXXX`
              });
            }
          } catch (error) {
            console.error('Database error:', error);
            await lineClient.replyMessage(event.replyToken, {
              type: 'text',
              text: '⚠️ เกิดข้อผิดพลาดในการตรวจสอบข้อมูล กรุณาลองใหม่อีกครั้ง'
            });
          }
        } else {
          await lineClient.replyMessage(event.replyToken, {
            type: 'text',
            text: '📱 กรุณากรอกหมายเลขโทรศัพท์ 10 หลักเพื่อลงทะเบียน\nตัวอย่าง: 0812345678'
          });
        }
      }
    }
    res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

// ตรวจสอบว่า user มีอยู่ในระบบหรือยัง
app.post("/api/check-user", async (req, res) => {
  const { userId } = req.body;
  const user = await prisma.user.findUnique({ where: { userId }, select: { role: true } });
  res.json({ exists: !!user, role: user.role });
});

// ลงทะเบียน user ใหม่
app.post("/api/register", async (req, res) => {
  const { userId, token, firstname, lastname, location, phone } = req.body;
  const user = await prisma.user.create({
    data: { userId, token, firstname, lastname, location, phone },
  });
  res.json(user);
});

app.post("/api/createUser", async (req, res) => {
  try {
    const { firstname, lastname, location, phone } = req.body;
    const user = await prisma.user.create({
      data: {
        firstname,
        lastname,
        phone,
        location,
      },
    });
    res.json({ message: "Create user successed!", data: user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/updateUser/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { firstname, lastname, phone, location } = req.body;
    const user = await prisma.user.update({
      where: { id: id },
      data: {
        firstname,
        lastname,
        phone,
        location,
      },
    });
    res.json({ message: "Update user successed!!", data: user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/updateRole/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const user = await prisma.user.update({
      where: { id: id },
      data: {
        role,
      },
    });
    res.json({ message: "Update role successed!!", data: user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error" });
  }
});

// ดึงข้อมูลผู้ใช้
app.get("/api/getUser/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { userId: id } });
    res.json({ message: "Get user successed", data: user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// ส่งข้อมูลแจ้งซ่อม
app.post(
  "/api/report",
  upload.fields([{ name: "image1" }, { name: "image2" }]),
  async (req, res) => {
    try {
      const { userId, type, detail } = req.body;
      const year = new Date().getFullYear();

      // Count reports for the current year
      const count = await prisma.report.count({
        where: {
          createdAt: {
            gte: new Date(`${year}-01-01`),
            lt: new Date(`${year + 1}-01-01`),
          },
        },
      });

      const sequence = String(count + 1).padStart(4, "0");
      const reportId = `${year}${sequence}`;

      // Upload images to Cloudinary
      const uploadToCloudinary = async (filePath) => {
        if (!filePath) return null;
        const result = await cloudinary.uploader.upload(filePath, {
          folder: "line-reports",
        });
        fs.unlinkSync(filePath);
        return result.secure_url;
      };

      const image1Url = req.files["image1"]?.[0]?.path
        ? await uploadToCloudinary(req.files["image1"][0].path)
        : null;
      const image2Url = req.files["image2"]?.[0]?.path
        ? await uploadToCloudinary(req.files["image2"][0].path)
        : null;

      // Create report
      const report = await prisma.report.create({
        data: {
          userId,
          type,
          detail,
          reportId,
          image1: image1Url,
          image2: image2Url,
        },
      });

      // Send LINE notifications
      const user = await prisma.user.findUnique({ where: { userId } });
      const message = `📋 แจ้งซ่อมใหม่จาก ID: \n${reportId} \n${
        user.firstname || "-"
      } ${user.lastname || "-"}\nประเภท: ${type}\nรายละเอียด: ${detail}`;

      const headers = {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      };

      // Notify user
      await axios.post(
        "https://api.line.me/v2/bot/message/push",
        {
          to: userId,
          messages: [
            { type: "text", text: "📌 ระบบได้รับรายการแจ้งซ่อมของคุณแล้ว" },
          ],
        },
        { headers }
      );

      // Notify group
      const groupMessage = {
        to: process.env.LINE_GROUP_ID,
        messages: [
          { type: "text", text: message },
          ...(image1Url
            ? [{
                type: "image",
                originalContentUrl: image1Url,
                previewImageUrl: image1Url,
              }]
            : []),
          ...(image2Url
            ? [{
                type: "image",
                originalContentUrl: image2Url,
                previewImageUrl: image2Url,
              }]
            : []),
        ],
      };

      await axios.post(
        "https://api.line.me/v2/bot/message/push",
        groupMessage,
        { headers }
      );

      res.json(report);
    } catch (error) {
      console.error("Error reporting:", error);
      res.status(500).json({ message: "เกิดข้อผิดพลาดในการแจ้งซ่อม" });
    }
  }
);

app.listen(3001, () => console.log("Server started on http://localhost:3001"));
