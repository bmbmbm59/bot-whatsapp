const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');

// 1. Serveur HTTP pour Render & UptimeRobot
const app = express();
const PORT = process.env.PORT || 3000;

let currentQrCodeImage = '';

// Page d'accueil
app.get('/', (req, res) => res.send('Bot WhatsApp actif ! Allez sur /qr pour voir le QR Code.'));

// Page Web avec image QR Code très facile à scanner
app.get('/qr', (req, res) => {
    if (currentQrCodeImage) {
        res.send(`
            <!DOCTYPE html>
            <html>
                <head>
                    <title>Connexion WhatsApp</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;background-color:#f0f2f5;">
                    <div style="background:white;padding:20px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.1);text-align:center;">
                        <h2>Scannez ce QR Code dans WhatsApp</h2>
                        <img src="${currentQrCodeImage}" style="width:280px;height:280px;" />
                        <p style="color:#666;font-size:14px;">Appareils connectés > Connecter un appareil</p>
                    </div>
                </body>
            </html>
        `);
    } else {
        res.send('<h2>QR Code indisponible (Le bot est déjà connecté ou en cours de démarrage).</h2>');
    }
});

app.listen(PORT, () => console.log(`Serveur Web prêt sur le port ${PORT}`));

// 2. Chemin du binaire Chrome installé par le script postinstall
const chromePath = path.join(
    '/opt/render/project/src/chrome/linux-146.0.7680.31/chrome-linux64/chrome'
);

// 3. Initialisation du client WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: chromePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

// 4. Variables de gestion des enchères
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

// 5. Gestion de la génération du QR Code
client.on('qr', async (qr) => {
    console.log('--- NOUVEAU QR CODE GÉNÉRÉ ---');
    qrcodeTerminal.generate(qr, { small: true });
    currentQrCodeImage = await QRCode.toDataURL(qr);
});

client.on('ready', () => {
    console.log('Bot Enchères Prêt !');
    currentQrCodeImage = '';
});

// 6. Traitement des commandes
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
