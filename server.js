require("dotenv").config()
const express = require("express")
const cors = require("cors")
const axios = require('axios');
const bodyParser = require('body-parser')
//@ts-ignore
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)


const PORT = process.env.PORT || 3001

const admin = require("firebase-admin")

var serviceAccount = {
    type: process.env.type,
    project_id: process.env.project_id,
    private_key_id: process.env.private_key_id,
    //@ts-ignore
    private_key: process.env.private_key.replace(/\\n/g, '\n'),
    client_email: process.env.client_email,
    client_id: process.env.client_id,
    auth_uri: process.env.auth_uri,
    token_uri: process.env.token_uri,
    auth_provider_x509_cert_url: process.env.auth_provider_x509_cert_url,
    client_x509_cert_url: process.env.client_x509_cert_url,
    universe_domain: process.env.universe_domain,
}

admin.initializeApp({
    //@ts-ignore
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.project_id
})

const app = express()

app.use(cors())
app.use(express.json())

app.use(bodyParser.json());

app.post('/create-checkout-session', async (req, res) => {
    const { program, studentId } = req.body

    const programItem = {
        price_data: {
            currency: "egp",
            product_data: {
                name: program.name,
                images: [program.image]
            },
            unit_amount: 2000
        },
        quantity: 1
    }

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [programItem],
        mode: "payment",
        success_url: "https://eng-me-black.vercel.app/",
        cancel_url: "https://eng-me-black.vercel.app/",
        metadata: {
            studentId,
            programId: program.id
        }
    })

    res.json({ id: session.id })
})

app.post('/callback', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_ENDPOINT_SECRET);
    } catch (err) {
        // console.error('Webhook Error:', err.message);
        // return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    if(event?.type)
    {

    }
    else if(req.body.type === 'checkout.session.completed')
    {
        if(req.body.data.object.payment_status === 'paid')
        {
            const db = admin.firestore()

            const newOrder = {
                studentId: req.body.data.object.metadata.studentId,
                programId: req.body.data.object.metadata.programId,
                orderId: req.body.data.object.id,
                status: 'accepted'
            }

            await db.collection('orders').add(newOrder)
        }
    }

})

app.listen(PORT, () => {
    console.log(`Server is running on ${PORT}`);
});