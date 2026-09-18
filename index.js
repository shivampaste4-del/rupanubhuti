require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use("/images", 
express.static(__dirname));
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "rupanubhuti.html"));
});
app.get("/api/test-db", async (req, res) => {
    try {
        const result = await pool.query("SELECT current_database()");
        res.json({
            message: "PostgreSQL connected successfully!",
            database: result.rows[0].current_database
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            message: "Database connection failed"
        });
    }
});


app.get("/api/customers", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM customer");
        res.json(result.rows);
    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            message: "Failed to fetch customers"
        });
    }
});

app.get("/api/bookings", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                b.booking_id,
                c.customer_name,
                c.phone,
                p.package_name,
                p.price,
                ph.photographer_name,
                e.event_type,
                e.event_date,
                e.venue,
                b.booking_date,
                b.booking_status
            FROM booking b
            JOIN customer c ON b.customer_id = c.customer_id
            JOIN package p ON b.package_id = p.package_id
            JOIN photographer ph ON b.photographer_id = ph.photographer_id
            JOIN event e ON b.event_id = e.event_id
            ORDER BY b.booking_id DESC
        `);

        res.json(result.rows);

    } catch (error) {
        console.error("Fetch Bookings Error:", error.message);

        res.status(500).json({
            message: "Failed to fetch bookings"
        });
    }
});

app.put("/api/bookings/:id/status", async (req, res) => {

    const bookingId = req.params.id;
    const { status } = req.body;

    try {

        const result = await pool.query(
            `UPDATE booking
             SET booking_status = $1
             WHERE booking_id = $2
             RETURNING booking_id, booking_status`,
            [status, bookingId]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                message: "Booking not found"
            });

        }

        res.json({
            message: "Booking status updated successfully!",
            booking: result.rows[0]
        });

    } catch (error) {

        console.error("Update Booking Status Error:", error.message);

        res.status(500).json({
            message: "Failed to update booking status"
        });

    }
});

app.post("/api/bookings", async (req, res) => {
    const {
        name,
        phone,
        email,
        package_id,
        date,
        time,
        event,
        photographer_id,
	payment_mode,
        message
    } = req.body;

    try {
        // 1. Check if customer already exists
        let customerResult = await pool.query(
            "SELECT customer_id FROM customer WHERE email = $1 OR phone = $2",
            [email, phone]
        );

      let customerId;

if (customerResult.rows.length === 0) {
    const newCustomer = await pool.query(
        `INSERT INTO customer
        (customer_name, phone, email, address)
        VALUES ($1, $2, $3, $4)
        RETURNING customer_id`,
        [name, phone, email, "Pune"]
    );

    customerId = newCustomer.rows[0].customer_id;
} else {
    customerId = customerResult.rows[0].customer_id;
}

if (!customerId) {
    throw new Error("Customer ID could not be found or created.");
}
        // 3. Create event
        const eventResult = await pool.query(
            `INSERT INTO event
            (customer_id, event_type, event_date, venue)
            VALUES ($1, $2, $3, $4)
            RETURNING event_id`,
            [customerId, event, date, "To be confirmed"]
        );

        const eventId = eventResult.rows[0].event_id;

        // 4. Create booking
        const bookingResult = await pool.query(
            `INSERT INTO booking
            (customer_id, package_id, photographer_id, event_id,
             booking_date, booking_status)
            VALUES ($1, $2, $3, $4, CURRENT_DATE, $5)
            RETURNING booking_id`,
            [
                customerId,
                package_id,
                photographer_id,
                eventId,
                "Pending"
            ]
        );

const bookingId = bookingResult.rows[0].booking_id;

const packageResult = await pool.query(
    "SELECT price FROM package WHERE package_id = $1",
    [package_id]
);

if (packageResult.rows.length === 0) {
    throw new Error("Package not found.");
}

const packagePrice = packageResult.rows[0].price;

await pool.query(
    `INSERT INTO payment
    (booking_id, payment_date, amount, payment_mode, payment_status)
    VALUES ($1, CURRENT_DATE, $2, $3, $4)`,
    [
        bookingId,
        packagePrice,
        "payment_mode",
        "Pending"
    ]
);

// Create automatic delivery record
await pool.query(
    `INSERT INTO delivery
    (booking_id, delivery_date, delivery_type, delivery_status)
    VALUES ($1, NULL, $2, $3)`,
    [
        bookingId,
        "Digital",
        "Pending"
    ]
);
        res.status(201).json({
            message: "Booking created successfully!",
            booking_id: bookingResult.rows[0].booking_id
        });

    } catch (error) {
        console.error("Booking Error:", error.message);

        res.status(500).json({
            message: "Failed to create booking",
            error: error.message
        });
    }
});


app.get("/api/payments", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                p.payment_id,
                p.booking_id,
                c.customer_name,
                pkg.package_name,
                p.payment_date,
                p.amount,
                p.payment_mode,
                p.payment_status
            FROM payment p
            JOIN booking b ON p.booking_id = b.booking_id
            JOIN customer c ON b.customer_id = c.customer_id
            JOIN package pkg ON b.package_id = pkg.package_id
            ORDER BY p.payment_id DESC
        `);

        res.json(result.rows);

    } catch (error) {
        console.error("Fetch Payments Error:", error.message);

        res.status(500).json({
            message: "Failed to fetch payments"
        });
    }
});   // 👈 THIS IS THE END
app.put("/api/payments/:id/status", async (req, res) => {

    const paymentId = req.params.id;
    const { status } = req.body;

    try {

        const result = await pool.query(
            `UPDATE payment
             SET payment_status = $1
             WHERE payment_id = $2
             RETURNING payment_id, payment_status`,
            [status, paymentId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Payment not found"
            });
        }

        res.json({
            message: "Payment status updated successfully!",
            payment: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Update Payment Status Error:",
            error.message
        );

        res.status(500).json({
            message: "Failed to update payment status"
        });
    }
});

app.get("/api/deliveries", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                d.delivery_id,
                d.booking_id,
                c.customer_name,
                p.package_name,
                d.delivery_date,
                d.delivery_type,
                d.delivery_status
            FROM delivery d
            JOIN booking b ON d.booking_id = b.booking_id
            JOIN customer c ON b.customer_id = c.customer_id
            JOIN package p ON b.package_id = p.package_id
            ORDER BY d.delivery_id DESC
        `);

        res.json(result.rows);

    } catch (error) {
        console.error("Fetch Deliveries Error:", error.message);

        res.status(500).json({
            message: "Failed to fetch deliveries"
        });
    }
});

app.put("/api/deliveries/:id/status", async (req, res) => {

    const deliveryId = req.params.id;
    const { status } = req.body;

    try {

        const result = await pool.query(
            `UPDATE delivery
             SET delivery_status = $1
             WHERE delivery_id = $2
             RETURNING delivery_id, delivery_status`,
            [status, deliveryId]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                message: "Delivery not found"
            });

        }

        res.json({
            message: "Delivery status updated successfully!",
            delivery: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Update Delivery Status Error:",
            error.message
        );

        res.status(500).json({
            message: "Failed to update delivery status"
        });

    }
});

app.get("/api/dashboard", async (req, res) => {
    try {
        const customers = await pool.query(
            "SELECT COUNT(*) AS total_customers FROM customer"
        );

        const bookings = await pool.query(
            "SELECT COUNT(*) AS total_bookings FROM booking"
        );

        const payments = await pool.query(
            "SELECT COALESCE(SUM(amount), 0) AS total_amount FROM payment"
        );

        const pendingPayments = await pool.query(
            "SELECT COUNT(*) AS pending_payments FROM payment WHERE payment_status = 'Pending'"
        );

        const pendingDeliveries = await pool.query(
            "SELECT COUNT(*) AS pending_deliveries FROM delivery WHERE delivery_status = 'Pending'"
        );

        const confirmedBookings = await pool.query(
            "SELECT COUNT(*) AS confirmed_bookings FROM booking WHERE booking_status = 'Confirmed'"
        );

        res.json({
            total_customers: Number(customers.rows[0].total_customers),
            total_bookings: Number(bookings.rows[0].total_bookings),
            total_amount: Number(payments.rows[0].total_amount),
            pending_payments: Number(pendingPayments.rows[0].pending_payments),
            pending_deliveries: Number(pendingDeliveries.rows[0].pending_deliveries),
            confirmed_bookings: Number(confirmedBookings.rows[0].confirmed_bookings)
        });

    } catch (error) {
        console.error("Dashboard Error:", error.message);

        res.status(500).json({
            message: "Failed to fetch dashboard data"
        });
    }
});
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});