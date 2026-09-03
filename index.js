const { Client, LocalAuth } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const qrcode = require('qrcode-terminal');
const express = require('express');

// Serveur HTTP pour Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot WhatsApp actif !'));
app.listen(PORT, () => console.log(`Serveur Web prêt sur le port ${PORT}`));

// Configuration universelle (Windows & Linux Render)
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});


// Serveur pour garder le bot en ligne
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot WhatsApp actif !'));
app.listen(PORT, () => console.log(`Serveur Web prêt sur le port ${PORT}`));

// Connexion WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const MAX_AUCTIONS = 10;
const auctions = new Map();

function formatTimeLeft(endTime) {
    const totalSeconds = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function generateProductCard(auctionId, auction) {
    const timeLeftFormatted = formatTimeLeft(auction.endTime);
    const bidderText = auction.highestBidder 
        ? `@${auction.highestBidder.split('@')[0]}` 
        : 'Aucune offre';

    return (
        `📦 **FICHE PRODUIT — ENCHÈRE #${auctionId}**\n` +
        `----------------------------------------\n` +
        `🏷️ **Article** : ${auction.item}\n` +
        `💰 **Offre actuelle** : *${auction.currentBid} €*\n` +
        `👑 **Dernier enchérisseur** : ${bidderText}\n` +
        `📈 **Pas de surenchère min.** : +${auction.minIncrement} €\n` +
        `⏱️ **Temps restant** : ⏳ *${timeLeftFormatted}*\n` +
        `----------------------------------------\n` +
        `👉 **!enchere ${auctionId} [Montant]**`
    );
}

client.on('qr', (qr) => {
    console.log('--- SCANNEZ CE QR CODE DANS WHATSAPP ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Bot Enchères Prêt !');
});

client.on('message', async (msg) => {
    const chat = await msg.getChat();
    const body = msg.body.trim();

    if (body.startsWith('!start')) {
        const args = body.split(' ');
        if (args.length < 6) return msg.reply('Format : !start [ID 1-10] [Nom] [PrixDepart] [PasMin] [Minutes]');
        const auctionId = parseInt(args[1]);
        const item = args[2];
        const startPrice = parseFloat(args[3]);
        const minIncrement = parseFloat(args[4]);
        const duration = parseInt(args[5]);

        if (isNaN(auctionId) || auctionId < 1 || auctionId > MAX_AUCTIONS) return msg.reply('L\'ID doit être entre 1 et 10.');
        if (auctions.has(auctionId) && auctions.get(auctionId).active) return msg.reply('Cet emplacement est déjà occupé.');

        const endTime = Date.now() + duration * 60000;
        const timer = setTimeout(() => {
            const currentAuction = auctions.get(auctionId);
            if (currentAuction && currentAuction.active) {
                currentAuction.active = false;
                if (currentAuction.highestBidder) {
                    chat.sendMessage(`🛑 **FIN DE L'ENCHÈRE #${auctionId}**\nRemporté par @${currentAuction.highestBidder.split('@')[0]} pour ${currentAuction.currentBid} € !`, { mentions: [currentAuction.highestBidder] });
                } else {
                    chat.sendMessage(`🛑 **FIN DE L'ENCHÈRE #${auctionId}**\nAucune offre.`);
                }
                auctions.delete(auctionId);
            }
        }, duration * 60000);

        const newAuction = { active: true, item, currentBid: startPrice, minIncrement, highestBidder: null, endTime, timer };
        auctions.set(auctionId, newAuction);
        chat.sendMessage(`🚀 **ENCHÈRE OUVERTE**\n\n` + generateProductCard(auctionId, newAuction));
    } 
    else if (body.startsWith('!enchere')) {
        const args = body.split(' ');
        if (args.length < 3) return msg.reply('Format : !enchere [ID] [Montant]');
        const auctionId = parseInt(args[1]);
        const bidAmount = parseFloat(args[2]);

        if (!auctions.has(auctionId) || !auctions.get(auctionId).active) return msg.reply('Enchère introuvable ou fermée.');
        const auction = auctions.get(auctionId);

        if (bidAmount < auction.currentBid + auction.minIncrement) {
            return msg.reply(`Offre trop basse. Minimum requis : ${auction.currentBid + auction.minIncrement} €`);
        }

        auction.currentBid = bidAmount;
        auction.highestBidder = msg.author || msg.from;
        chat.sendMessage(`✅ **NOUVELLE OFFRE !**\n\n` + generateProductCard(auctionId, auction), { mentions: [auction.highestBidder] });
    }
});

client.initialize();
