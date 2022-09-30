const ViberBot = require('viber-bot').Bot;
const BotEvents = require('viber-bot').Events;
const TextMessage = require('viber-bot').Message.Text;

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const mongoose = require('mongoose');
const nodeFetch = require('node-fetch');
const bodyParser = require("body-parser");
const winston = require('winston');
const wcf = require('winston-console-formatter'); // makes the output more friendly

require('dotenv').config();

const user = process.env.DB_USER;
const pwd = process.env.DB_PWD;
const dbPort = process.env.DB_PORT;
const addr = process.env.DB_ADDR;

mongoose.connect(`mongodb://${user}:${pwd}@${addr}:${dbPort}/timesheetsblocks?authSource=admin`, {useNewUrlParser: true, useUnifiedTopology: true});

const mongodb = mongoose.connection;
mongodb.on('error', console.error.bind(console, 'connection error:'));
mongodb.once('open', function(msg) {
    // we're connected!
    console.log(`${new Date().toLocaleString('ru')} Mongoose connected: `, msg);
});

const inventoriesViberMailingSchema = new mongoose.Schema({
    direction: {
        type: String,
        required: true,
        unique: true,
    },
    viber_user_ids: [{
        type: String,
        required: true,
        unique: false,
    }]
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });
const InventoriesViberMailing = mongoose.model('InventoriesViberMailing', inventoriesViberMailingSchema);

const createLogger = () => {
    const logger = new winston.Logger({
        level: "debug"
    }); // We recommend DEBUG for development
    logger.add(winston.transports.Console, wcf());
    return logger;
}

const loggerViber = createLogger();

const bot = new ViberBot({
    logger: loggerViber,
    authToken: process.env.TOKEN,
    name: "Описи",
    avatar: "http://viber.com/avatar.jpg" // It is recommended to be 720x720, and no more than 100kb.
});

bot.on(BotEvents.MESSAGE_RECEIVED, async(message, response) => {
    console.log('----------------------------------------------------------------');
    console.log(`${new Date().toLocaleString('ru')} New message: `, message.text);
    console.log('From: ', response.userProfile.id, );
    console.log('Name: ', response.userProfile.name);

    bot.sendMessage({id: process.env.ADMIN_ID}, new TextMessage(`New message from user: ${response.userProfile.id} ${response.userProfile.name}: ${message.text}`));

    const newItem = await addAndDeleteViberUserIdToDirection(response.userProfile.id, message.text);

    if(!newItem) {
        bot.sendMessage({id: response.userProfile.id}, new TextMessage(`Ошибка добавления города`));
        // @ts-ignore
        await sendServiceMessage(`viber-inventories: Ошибка получения/добавления города у ${response.userProfile.name} - ${response.userProfile.id}`, process.env.SECRET);
        return;
    }

    const directions = await getDirectionsByViberUserId(response.userProfile.id);

    if(!directions) {
        bot.sendMessage({id: response.userProfile.id}, new TextMessage(`Ошибка получения вашего списка городов`));
        // @ts-ignore
        await sendServiceMessage(`viber: Ошибка получения списка городов у ${response.userProfile.name} - ${response.userProfile.id}`, process.env.SECRET);
        return;
    } else {
        bot.sendMessage({id: response.userProfile.id}, new TextMessage(`Вы подписаны на города: ${directions.join(', ')}`));
    }

    // response.send(message);
});

const getViberUserIdsByDirection = async (direction) => {
    let items;
    try {
        items = await InventoriesViberMailing.find({direction}).exec();
        console.log(`${new Date().toLocaleString('ru')} Getting viber user ids by direction result: `, items);
    } catch (e) {
        console.log(`${new Date().toLocaleString('ru')} Getting viber user ids by direction error: `, e);
        return null;
    }
    if(!items) return null;
    return items.length ? items[0].viber_user_ids : [];
}

const addAndDeleteViberUserIdToDirection = async (userId, direction) => {
    const viberUserIds = await getViberUserIdsByDirection(direction);
    if(!viberUserIds) {
        console.log(`${new Date().toLocaleString('ru')} Gonna add userId to direction: `, userId, direction);
        let result;
        try {
            const newItem = new InventoriesViberMailing({direction, viber_user_ids: [userId]});
            result = await newItem.save();
            console.log(`${new Date().toLocaleString('ru')} Direction added with result: `, result);
        } catch(err) {
            console.log(`${new Date().toLocaleString('ru')} Direction adding error: `, err);
            result = false;
        }
        return result;
    } else {
        console.log(`${new Date().toLocaleString('ru')} There are viber users for ${direction}: `, viberUserIds);
        let newIds;
        if(viberUserIds.includes(userId)) {
            newIds = viberUserIds.filter((viberUserId) => viberUserId !== userId);
        } else {
            newIds = [...viberUserIds, userId];
        }
        let item;
        try {
            console.log(`${new Date().toLocaleString('ru')} Gonna update ${direction} with new ids: `, newIds);
            item = await InventoriesViberMailing.findOneAndUpdate({direction}, {viber_user_ids: newIds}, {new: true}).exec();
            console.log(`${new Date().toLocaleString('ru')} Updating viber user ids on ${direction} result: `, item);
            return item;
        } catch (e) {
            console.log(`${new Date().toLocaleString('ru')} Updating viber user ids on ${direction} error: `, e);
            return false;
        }
    }
}

const getDirectionsByViberUserId = async(userId) => {
    console.log(`${new Date().toLocaleString('ru')} Gonna get directions by userId: `, userId);
    let items;
    try {
        items = await InventoriesViberMailing.find({viber_user_ids: userId}).exec();
        console.log(`${new Date().toLocaleString('ru')} Getting directions by viber user id ${userId} items: `, items);
        const directions = items.map((item) => item.direction);
        console.log(`${new Date().toLocaleString('ru')} Getting directions by viber user id ${userId} result: `, directions);
        return directions;
    } catch (e) {
        console.log(`${new Date().toLocaleString('ru')} Getting directions by viber user id ${userId}  error: `, e);
        return false;
    }
};

const sendServiceMessage = async (messageText, st) => {

    const url = process.env.SERVER_ADDR + "sendservicemessage";

    try {
        const response = await nodeFetch(url, {
            method: 'POST', // *GET, POST, PUT, DELETE, etc.
            // mode: 'cors', // no-cors, *cors, same-origin
            // cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
            // credentials: 'same-origin', // include, *same-origin, omit
            headers: {
                'Content-Type': 'application/json'
                // 'Content-Type': 'application/x-www-form-urlencoded',
            },
            // redirect: 'follow', // manual, *follow, error
            // referrerPolicy: 'no-referrer', // no-referrer, *client
            body: JSON.stringify({ messageText, st }) // body data type must match "Content-Type" header
        });
        return await response.json(); // parses JSON response into native JavaScript objects
    } catch (e) {
        console.error(`${new Date().toLocaleString('ru')} Sending`, e);
        return false;
    }
};

// var indexRouter = require('./routes/index');
// var usersRouter = require('./routes/users');

const app = express();

app.use(logger('dev'));
//app.use(express.json());
//app.use(express.urlencoded({ extended: false }));
//app.use(cookieParser());
//app.use(express.static(path.join(__dirname, 'public')));
//app.use(bodyParser.json())

app.use("/viber/webhook", bot.middleware());

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader("Access-Control-Allow-Headers", "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers, Authorization");
    next();
});

app.post('/inventory', bodyParser.json(), async (req, res) => {

    console.log(`${new Date().toLocaleString('ru')} Post package inventory: `, req.body.direction, req.body.inventoryStr);

    const usersIds = await getViberUserIdsByDirection(req.body.direction);

    if(!usersIds) {
        console.error(`${new Date().toLocaleString('ru')} Getting viber user ids by direction error`);
        // @ts-ignore
        await sendServiceMessage(`viber: Ошибка получения пользователей по городу ${req.body.direction}`, process.env.SECRET);
        res.status(500).end();
        return;
    }

    if(!usersIds.length) {
        console.log(`${new Date().toLocaleString('ru')} No users to send ${req.body.direction} inventory`);
        // @ts-ignore
        await sendServiceMessage(`viber: Нет подписчиков для описи ${req.body.direction}`, process.env.SECRET);
        res.status(410).end();
        return;
    }

    for(const userId of usersIds) {
        const result = await bot.sendMessage(
            {id: userId},
            new TextMessage(
                req.body.inventoryStr
            )
        );
    }

    res.status(200).send();
});


// app.use('/', indexRouter);
// app.use('/users', usersRouter);

module.exports.app = app;
module.exports.bot = bot;
