const express = require('express')
const app = express()
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const multer = require('multer')
const { PrismaClient } = require('@prisma/client')


const prisma = new PrismaClient()
app.use(cors())
app.use(express.json())
app.use('/uploads', express.static('uploads'))

const upload = multer({ dest: 'uploads/' })

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

app.get('/api/getUser/:id', async (req, res) => {
  try {
    const { id } = req.params
    const user = await prisma.user.findUnique({
      where: {
        userId: id
      }
    })
    res.json({ message: "Get user successed", data: user })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: "Server error" })
  }
})

// ส่งข้อมูลแจ้งซ่อม
app.post('/api/report', upload.fields([{ name: 'image1' }, { name: 'image2' }]), async (req, res) => {
  const { userId, type, detail } = req.body
  const image1 = req.files['image1'][0].path
  const image2 = req.files['image2'][0].path

  const report = await prisma.report.create({
    data: { userId, type, detail, image1, image2 }
  })

  const user = await prisma.user.findUnique({ where: { userId } })

  const message = `📋 แจ้งซ่อมใหม่จาก ${user.firstname} ${user.lastname}\nประเภท: ${type}\nรายละเอียด: ${detail}`
  const image1Url = `${req.protocol}://${req.get('host')}/${image1}`
  const image2Url = `${req.protocol}://${req.get('host')}/${image2}`

  const headers = {
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }

  // ส่งหาผู้แจ้ง
  await axios.post('https://api.line.me/v2/bot/message/push', {
    to: userId,
    messages: [{ type: 'text', text: '📌 ระบบได้รับรายการแจ้งซ่อมของคุณแล้ว' }]
  }, { headers })

  // ส่งไปยังกลุ่ม
  await axios.post('https://api.line.me/v2/bot/message/push', {
    to: process.env.LINE_GROUP_ID,
    messages: [
      { type: 'text', text: message },
      { type: 'image', originalContentUrl: image1Url, previewImageUrl: image1Url },
      { type: 'image', originalContentUrl: image2Url, previewImageUrl: image2Url }
    ]
  }, { headers })

  res.json(report)
})

app.listen(3001, () => console.log('Server started on http://localhost:3001'))