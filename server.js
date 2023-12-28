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

app.use(bodyParser.json())

app.post('/generate-teacher-account', async (req, res) => {
    const { teacher } = req.body

    const db = admin.firestore()

    const teacherStripeRef = db.collection('teacherStripe').where('teacherId', '==', teacher.id)

    const teacherStripeDocs = await teacherStripeRef.get()

    if(teacherStripeDocs?.docs.length && teacherStripeDocs?.docs[0]?.data())
    {
        const stripeAccount = teacherStripeDocs.docs[0].data().stripeAccount
    
        const accountLink = await stripe.accountLinks.create({
            account: stripeAccount,
            refresh_url: 'https://eng-me-black.vercel.app',
            return_url: 'https://eng-me-black.vercel.app',
            type: 'account_onboarding'
        })
    
        const teacherData = db.collection('teachers').doc(teacher.id)
    
        await teacherData.update({
            firstLoginLink: accountLink.url
        })
    }
})

app.post('/create-teacher-account', async (req, res) => {
    const { request, password } = req.body

    const db = admin.firestore()

    const account = await stripe.accounts.create({
        type: 'express',
        country: 'EG',
        email: request.email,
        capabilities: {
            transfers: {
                requested: true,
            },
        },
        business_type: 'individual',
        individual: {
            email: request.email
        },
        tos_acceptance: {
            service_agreement: 'recipient',
        },
    })

    const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: 'https://eng-me-black.vercel.app',
        return_url: 'https://eng-me-black.vercel.app',
        type: 'account_onboarding'
    })
    
    const teacherRequestRef = db.doc(`teacherRequest/${request.id}`)
    
    const user = await admin.auth().createUser({
        email: request.email,
        password
    })

    const uid = user.uid

    const teacherStripeRef = db.collection('teacherStripe')

    const addedTeacherStripe = await teacherStripeRef.add({
        teacherId: uid,
        stripeAccount: account.id
    })

    
    const teacherRef = db.doc(`teachers/${uid}`);

    await teacherRef.set({
        friends: [],
        name: request.name,
        email: request.email,
        image: '',
        programs: [],
        title: 'Professor in Human Biology',
        university: 'The German University in Cairo',
        averageRating: 0,
        profileViews: 0,
        firstLoginLink: accountLink.url,
        stripeId: addedTeacherStripe.id
    })

    const scheduleRef = db.collection('teacherSchedule')

    await scheduleRef.add({
        numberOfDays: 6,
        slots: [
        {
            day: 'Sunday',
            endTime: '2 PM',
            startTime: '1 PM',
        },
        ],
        teacherId: uid,
    })

    const userRef = db.collection('users')

    await userRef.add({
        userId: request.email,
        role: 'teacher',
        number: request.number,
    })

    await teacherRequestRef.delete()
})

app.post('/create-checkout-session', async (req, res) => {
    const { program, studentId } = req.body

    const db = admin.firestore()

    const teacherStripeRef = db.collection('teacherStripe')
    const teacherStripeData = await teacherStripeRef.where('teacherId', '==', program.teacherId).limit(1).get()

    const accountId = teacherStripeData.docs[0].data().stripeAccount

    const programItem = {
        price_data: {
            currency: "egp",
            product_data: {
                name: program.name,
                images: [program.image.length < 2048 ? program.image : 'https://firebasestorage.googleapis.com/v0/b/engmedemo.appspot.com/o/ProgramImages%2Fcardpic-min.png?alt=media&token=6e306470-2c2f-46fb-be2f-bb8a948741e2']
            },
            unit_amount: program.price * 100
        },
        quantity: 1
    }

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [programItem],
        mode: "payment",
        success_url: "https://eng-me-black.vercel.app/",
        cancel_url: "https://eng-me-black.vercel.app/",
        payment_intent_data: {
            transfer_data: {
                destination: accountId, // Replace with the teacher's connected Stripe account ID
                amount: Math.floor((program.price * ( Number(program.teacherShare) / 100 )) * 100),
            },
        },
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
    
    const db = admin.firestore()
    
    if(event?.type)
    {

    }
    else if(req.body.type === 'checkout.session.completed')
    {
        if(req.body.data.object.payment_status === 'paid')
        {

            const newOrder = {
                studentId: req.body.data.object.metadata.studentId,
                programId: req.body.data.object.metadata.programId,
                orderId: req.body.data.object.id,
                status: 'accepted'
            }

            await db.collection('orders').add(newOrder)
        }
    }
    else if(req.body.type === 'capability.updated')
    {
        if(req.body.data.object.status === 'active')
        {
            const teacherStripeRef = db.collection('teacherStripe')
            const teacherStripeData = await teacherStripeRef.where('stripeAccount', '==', req.body.data.object.account).limit(1).get()

            const teacherId = teacherStripeData.docs[0].data().teacherId

            const teachersData = db.collection('teachers').doc(teacherId)

            await teachersData.update({
                firstLoginLink: admin.firestore.FieldValue.delete()
            })
        }
    }
})

app.listen(PORT, () => {
    console.log(`Server is running on ${PORT}`);
});