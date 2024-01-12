const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const app = express();
const port = process.env.PORT || 3000;
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY)


//middelware
app.use(cors());
app.use(express.json())



const verifyJWT = (req, res, next) =>{
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(401).send({error: true, message: 'unauthorized access'})
  }
  //bearer token
  const token = authorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err,decoded) =>{
    if(err){
      return res.status(401).send({error: true, message: 'unauthorized access'})
    }
    else{
      req.decoded = decoded;
      next();
    }
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jz0ivtr.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    
    const userCollection = client.db("BistroBossResDB").collection("users");
    const menuCollection = client.db("BistroBossResDB").collection("menus");
    const reviewCollection = client.db("BistroBossResDB").collection("reviews");
    const cartCollection = client.db("BistroBossResDB").collection('carts');
    const bookingCollection = client.db("BistroBossResDB").collection('booking');
    const paymentCollection = client.db("BistroBossResDB").collection('PaymentHistory');
    // console.log(process.env.ACCESS_TOKEN_SECRET)

    app.post('/jwt', (req,res) =>{
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1hr'})

      res.send({token})
    })
    
    //Warning: use verifyJWT before using verifyAdmin
    const verifyAdmin = async(req, res, next) =>{
      const email = req.decoded.email;
      const query = {email: email}
      const user = await userCollection.findOne(query)
      if(user?.roll !== 'admin'){
        return res.status(403).send({error: true, message: 'forbidden message'})
      }
      next()
    }

    /**
     * 0. do not show secure links to those who should not see the links
     * 1. use jwt token: verifyJWT
     * 3. use verifyAdmin middleware
     */

    //user related api
    app.get('/users', verifyJWT, async(req,res) =>{
      const result = await userCollection.find().toArray();
      res.send(result);
    })


    app.post('/users', async(req,res) =>{
      const user = req.body;
      // console.log(user)
      const query = {email: user.email}

      const existingUser = await userCollection.findOne(query)
      if(existingUser){
        return res.send({message: "user already exists"});
      }
      const result = await userCollection.insertOne(user)
      res.send(result)
    })

    // security layer: verifyJWT
    //email same
    // check admin
    app.get('/users/admin/:email', verifyJWT,verifyAdmin, async(req,res) =>{
      const email = req.params.email;
      console.log(email)

      if(req.decoded.email !== email){
        res.send({ admin: false})
      }

      const query = {email: email};
      const user = await userCollection.findOne(query);
      const result = { admin: user?.roll === 'admin'};
      res.send(result)
    })

    app.patch('/users/admin/:id', async(req,res) =>{
      const id = req.params.id
      console.log(id)
      const filter = {_id: new ObjectId(id)};
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };

      const result = await userCollection.updateOne(filter,updateDoc);
      // console.log(result)
      res.send(result)
    })

    //admin dashbaord related api 
    app.get('/admin-stats', verifyJWT, verifyAdmin, async(req,res) =>{
      const users = await userCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      
      //best way to get sum of a field is to use group and sum operator
      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce( (sum, payment) => sum + payment.price, 0)

      res.send({
        users,
        products,
        orders,
        revenue
      })
    })
    
    /**
     * ------------------
     * Bangla System(second best solution)
     * -------------------
     * 1. load all payments
     * 2. for each payment, get the menuItems array
     * 3. for each item in the menuItems array get the menuItem from 
     *    menu collection
     * 4. put them in an array: allOrderedItems
     * 5. separate allOrderedItems by category using filter
     * 6. now get the quantity by using length: pizzas.length
     * 7. for each category use reduce to get the total amount 
     *    spent on this category
     */
    // // app.get('/order-stats', async(req,res) => {
    //   const pipeline = [
    //     {
    //       $lookup: {
    //         from: 'menus',
    //         localField: 'menuItems',
    //         foreignField: '_id',
    //         as: 'menuItemsData'
    //       }
    //     },
    //     {
    //       $unwind: '$menuItemsData'
    //     },
    //     {

          
    //       $group: {
    //         _id: '$menuItemsData.category',
    //         count: {$sum: 1},
    //         totalPrice: { $sum: '$menuItemsData.price'}
    //       }
    //     }
    //   ];
    //   console.log(pipeline)
    //   // console.log(await paymentCollection.aggregate(pipeline).toArray())

    //   const result = await paymentCollection.aggregate(pipeline).toArray()
    //   res.send(result)
    // // })

    

    //menu related api
   
        // using aggregate pipeline
        app.get('/order-stats',  async(req, res) =>{
          const result = await paymentCollection.aggregate([
            {
              $lookup: {
                from: 'menus',
                localField: 'menuItems',
                foreignField: '_id',
                as: 'menuItemsData'
              }
            },

            {
              $unwind: '$menuItemsData'
            },

            // {
            //   $group: {
            //     _id: '$menuItemsData.category',
            //     quantity:{ $sum: 1 },
            //     revenue: { $sum: '$menuItemsData.price'} 
            //   }
            // },

            // {
            //   $project: {
            //     _id: 0,
            //     category: '$_id',
            //     quantity: '$quantity',
            //     revenue: '$revenue'
            //   }
            // }

          ]).toArray();

          console.log('this is result ',result)
    
          res.send(result);
    
        })
    
   
    app.get('/menus', async(req,res) =>{
        const data = await menuCollection.find().toArray()
        res.send(data);
    })

    app.post('/menu', verifyJWT, verifyAdmin, async(req,res) =>{
      const newItem = req.body;
      const result = await menuCollection.insertOne(newItem)
      res.send(result);
    })

    app.delete('/menu/:id', verifyJWT, verifyAdmin, async(req,res) =>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    })

    //cart collection api
    app.get('/carts', verifyJWT, async(req,res) =>{
      const email = req.query.email
      // console.log(email)
      if(!email){
        res.send([]);
      }
      else{

        const decodedEmail = req.decoded.email;
        if(email !== decodedEmail){
          return res.status(403).send({ error: true, message: 'providen access'})
        }
        const query = {email: email};
        const result = await cartCollection.find(query).toArray();
        res.send(result)
      }
    })
    
    app.post('/carts', async(req,res) =>{
      const item = req.body;
      // console.log(item);
      const result = await cartCollection.insertOne(item);
      res.send(result);
    })

    app.delete('/carts/:id', async(req,res) =>{
       const id = req.params.id;
       const query = {_id: new ObjectId(id)}
       const result = await cartCollection.deleteOne(query)
      //  console.log(result)
       res.send(result)
    })

    //review related api
    app.get('/reviews', async(req,res) =>{
      const result = await reviewCollection.find().toArray()
      res.send(result)
    })

    app.post('/addReview', async(req,res) =>{
      const data = req.body;
      console.log(data)
      const result = await reviewCollection.insertOne(data);
      res.send(result)
    })

    //resevation related api
    app.get("/bookings", verifyJWT, async(req,res) =>{
      const email = req.query.email
      // console.log(email)
      if(!email){
        res.send([]);
      }
      else{

        const decodedEmail = req.decoded.email;
        if(email !== decodedEmail){
          return res.status(403).send({ error: true, message: 'providen access'})
        }
        const query = {BookingUser: email};
        const result = await bookingCollection.find(query).toArray();
        res.send(result)
      }
    })


    app.post('/addBooking', async(req, res) =>{
      const data = req.body;
      // console.log(data)
      const result = await bookingCollection.insertOne(data)
      res.send(result)
    })
   
    app.delete('/bookings/:id', async(req,res) =>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await bookingCollection.deleteOne(query)
      console.log(result)
      res.send(result)
    })
    //payment related api
    app.get('/payments/:email', async(req,res) =>{
      const email = req.params.email;
      console.log(email);
      const query = {email: email}
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    })
    app.post('/payments', verifyJWT, async(req,res) =>{
      const payment = req.body;
      // console.log(payment)
      const result = await paymentCollection.insertOne(payment)

      const query = {_id: { $in: payment.cartItems.map(id => new ObjectId(id))}}
      const deleteResult = await cartCollection.deleteMany(query)
      res.send({result, deleteResult})

      
    })
    
    //payment related work
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
        const { price } = req.body;
        const amount = parseInt((price*100));
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: 'usd',
          payment_method_types: ['card']
        })
        
        res.send({
          clientSecret: paymentIntent.client_secret
        })
        });

    

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req,res) => {
    res.send("Bistro boss restaurant server is running!!!")
})

app.listen(port, ()=>{
    console.log("bistro boss server is running on port ",port)
})


/**
 * ---------------------------------
 *           Naming Convention
 * ----------------------------------
 * users : userCollection
 * app.get('/users')
 * app.get('/users/:id')
 * app.post('/users')
 * app.patch('/users/:id')
 * app.put('/users/:id')
 * app.delete('/users/:id')
 */