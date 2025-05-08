const express = require('express')
const app = express()
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const multer = require('multer')
const { PrismaClient } = require('@prisma/client')
const favicon = require('serve-favicon')
const cloudinary = require('cloudinary').v2

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

const prisma = new PrismaClient()

app.use(cors())
app.use(express.json())

// ใช้ favicon ถ้ามี
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));

// ✅ ใช้ /tmp/uploads แทน uploads/
const tempUploadDir = '/tmp/uploads'
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true })
}

const upload = multer({ dest: tempUploadDir })

// ตรวจสอบว่า user มีอยู่ในระบบหรือยัง
app.post('/api/check-user', async (req, res) => {
  const { userId } = req.body
  const user = await prisma.user.findUnique({ where: { userId } })
  res.json({ exists: !!user })
})

// ลงทะเบียน user ใหม่
app.post('/api/register', async (req, res) => {
  const { userId, token, firstname, lastname, location, phone } = req.body
  const user = await prisma.user.create({
    data: { userId, token, firstname, lastname, location, phone }
  })
  res.json(user)
})

// ดึงข้อมูลผู้ใช้
app.get('/api/getUser/:id', async (req, res) => {
  try {
    const { id } = req.params
    const user = await prisma.user.findUnique({ where: { userId: id } })
    res.json({ message: "Get user successed", data: user })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Server error" })
  }
})

// ส่งข้อมูลแจ้งซ่อม
app.post('/api/report', upload.fields([{ name: 'image1' }, { name: 'image2' }]), async (req, res) => {
  try {
    const { userId, type, detail } = req.body

    const uploadToCloudinary = async (filePath) => {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: 'line-reports'
      })
      fs.unlinkSync(filePath) // ลบไฟล์หลังอัปโหลด
      return result.secure_url
    }

    const image1Path = req.files['image1']?.[0]?.path
    const image2Path = req.files['image2']?.[0]?.path

    const image1Url = image1Path ? await uploadToCloudinary(image1Path) : null
    const image2Url = image2Path ? await uploadToCloudinary(image2Path) : null

    const report = await prisma.report.create({
      data: { userId, type, detail, image1: image1Url, image2: image2Url }
    })

    const user = await prisma.user.findUnique({ where: { userId } })

    const message = `📋 แจ้งซ่อมใหม่จาก \n${user.firstname || '-'} ${user.lastname || '-'}\nประเภท: ${type}\nรายละเอียด: ${detail}`

    const headers = {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [{ type: 'text', text: '📌 ระบบได้รับรายการแจ้งซ่อมของคุณแล้ว' }]
    }, { headers })

    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: process.env.LINE_GROUP_ID,
      messages: [
        { type: 'text', text: message },
        ...(image1Url ? [{ type: 'image', originalContentUrl: image1Url, previewImageUrl: image1Url }] : []),
        ...(image2Url ? [{ type: 'image', originalContentUrl: image2Url, previewImageUrl: image2Url }] : [])
      ]
    }, { headers })

    res.json(report)
  } catch (error) {
    console.error('Error reporting:', error)
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการแจ้งซ่อม' })
  }
})

app.listen(3001, () => console.log('Server started on http://localhost:3001'))
