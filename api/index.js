require("dotenv").config()
const express = require("express")
const cors = require("cors")
const bodyParser = require('body-parser')
//@ts-ignore
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

const nodemailer = require('nodemailer')

const PORT = process.env.PORT || 3001

const admin = require("firebase-admin")

const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, 
    }
})

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

app.get('/', (req, res) => {
    return res.status(200).json({ message: 'Api activated' })
})

app.post('/send-mail-company', async (req, res) => {
    const { name, email, message, companyName } = req.body

    transporter.sendMail({
        to: ['admin@engme.org'],
        subject: 'New Company Application',
        html: `<h1>Company Name: ${companyName}</h1><br /><h2><h2>Name: ${name}</h2><br />Email: ${email}</h2><br /><p>${message}</p>`
    })
})

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
            refresh_url: 'https://stripe.com',
            return_url: 'https://engme.org',
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

    console.log(req.body)

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
        refresh_url: 'https://stripe.com/',
        return_url: 'https://engme.org',
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
        occupation: request.occupation,
        why: request.why,
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
        hourlyRate: "0"
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
    const { program, studentId, teacherId, hourlyRate, bundle } = req.body

    const db = admin.firestore()

    const teacherStripeRef = db.collection('teacherStripe')

    console.log('TestApi')

    if(program)
    {
        const teacherStripeData = await teacherStripeRef.where('teacherId', '==', program.teacherId).limit(1).get()
    
        const accountId = teacherStripeData.docs[0].data().stripeAccount

        const price = typeof program.price === 'string' ? parseInt(program.price) : program.price
        const discount = typeof program.discount === 'string' ? parseInt(program.discount) : program.discount

        console.log("price: ", price)
        console.log("discount: ", discount)
    
        const programItem = {
            price_data: {
                currency: "usd",
                product_data: {
                    name: program.name,
                    images: [program.image.length < 2048 && program.image.length > 0 ? program.image : 'https://firebasestorage.googleapis.com/v0/b/engmedemo.appspot.com/o/ProgramImages%2Fcardpic-min.png?alt=media&token=6e306470-2c2f-46fb-be2f-bb8a948741e2']
                },
                unit_amount: Math.floor(((price) * (1 - ((discount ?? 0) / 100))) * 100)
            },
            quantity: 1
        }
    
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [programItem],
            mode: "payment",
            allow_promotion_codes: true,
            success_url: `https://engme.org/programs/current/${program.id}`,
            cancel_url: "https://engme.org/",
            payment_intent_data: {
                transfer_data: {
                    destination: accountId,
                    amount: Math.floor(((price * (1 - ((discount ?? 0) / 100))) * ( Number(program.teacherShare) / 100 )) * 100),
                },
            },
            metadata: {
                studentId,
                programId: program.id
            }
        })
    
        res.json({ id: session.id })
    }
    else if(teacherId)
    {
        console.log(teacherId)
        const teacherStripeData = await teacherStripeRef.where('teacherId', '==', teacherId).limit(1).get()
    
        const accountId = teacherStripeData.docs[0].data().stripeAccount

        const consultationItem = {
            price_data: {
                currency: "usd",
                product_data: {
                    name: 'Consultation Session',
                    images: ['https://firebasestorage.googleapis.com/v0/b/engmedemo.appspot.com/o/ProgramImages%2Fcardpic-min.png?alt=media&token=6e306470-2c2f-46fb-be2f-bb8a948741e2']
                },
                unit_amount: parseFloat(hourlyRate) * 100
            },
            quantity: 1
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [consultationItem],
            mode: "payment",
            success_url: `https://engme.org/`,
            cancel_url: "https://engme.org/",
            payment_intent_data: {
                transfer_data: {
                    destination: accountId,
                    amount: parseFloat(hourlyRate) * 100,
                },
            },
            metadata: {
                studentId,
                teacherId
            }
        })
    
        res.json({ id: session.id })
    }
    else if(bundle) 
    {
        const teacherStripeData = await teacherStripeRef.where('teacherId', '==', bundle.teacherId).limit(1).get()

        const accountId = teacherStripeData.docs[0].data().stripeAccount

        const bundleItem = {
            price_data: {
                currency: "usd",
                product_data: {
                    name: "Bundle",
                    images: [bundle.image.length < 2048 && bundle.image.length > 0 ? bundle.image : 'https://firebasestorage.googleapis.com/v0/b/engmedemo.appspot.com/o/ProgramImages%2Fcardpic-min.png?alt=media&token=6e306470-2c2f-46fb-be2f-bb8a948741e2']
                },
                unit_amount: (bundle.price * (1 - ((bundle?.discount ?? 0) / 100))) * 100
            },
            quantity: 1
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [bundleItem],
            mode: "payment",
            allow_promotion_codes: true,
            success_url: `https://engme.org/programs`,
            cancel_url: "https://engme.org/",
            payment_intent_data: {
                transfer_data: {
                    destination: accountId,
                    amount: Math.floor(((bundle.price * (1 - ((bundle?.discount ?? 0) / 100))) * ( Number(bundle.teacherShare) / 100 )) * 100),
                },
            },
            metadata: {
                studentId,
                programs: JSON.stringify(bundle.programs)
            }
        })
    
        res.json({ id: session.id })
    }
})

app.post('/callback', async (req, res) => {
    console.log('Entered Callback')

    const sig = req.headers['stripe-signature'];

    console.log('Entered Callback')
    
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
        console.log("type: ", event.type)
    }
    else if(req.body.type === 'checkout.session.completed')
    {
        if(req.body.data.object.payment_status === 'paid')
        {
            if(req.body.data.object.metadata.programId)
            {
                const newOrder = {
                    studentId: req.body.data.object.metadata.studentId,
                    programId: req.body.data.object.metadata.programId,
                    orderId: req.body.data.object.id,
                    status: 'accepted'
                }
    
                await db.collection('orders').add(newOrder)
            }
            else if(req.body.data.object.metadata.teacherId)
            {
                const newOrder = {
                    studentId: req.body.data.object.metadata.studentId,
                    teacherId: req.body.data.object.metadata.teacherId,
                    orderId: req.body.data.object.id,
                    status: 'accepted'
                }
    
                await db.collection('ordersConsultations').add(newOrder)
            }
            else if(req.body.data.object.metadata.programs)
            {   
                const programs = JSON.parse(req.body.data.object.metadata.programs)
                const newOrder = {
                    studentId: req.body.data.object.metadata.studentId,
                    programs: programs,
                    orderId: req.body.data.object.id,
                    status: 'accepted'
                }
        
                await db.collection('orders').add(newOrder)
            }
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

module.exports = app;
