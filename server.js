const express = require('express');
const path = require('path');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:ReijhdfxbdGOWrkHEeygkywQEYcICIxG@yamanote.proxy.rlwy.net:12646';
const DB_NAME = 'rovel';
let db, client;

// Connect to MongoDB
async function connectToMongo() {
  try {
    client = new MongoClient(MONGO_URL);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('Connected to MongoDB successfully');
    
    // Create indexes
    await db.collection('manga').createIndex({ id: 1 }, { unique: true });
    await db.collection('novels').createIndex({ id: 1 }, { unique: true });
    await db.collection('chapters').createIndex({ normalizedTitle: 1, chapterId: 1 }, { unique: true });
    await db.collection('users').createIndex({ id: 1 }, { unique: true });
    
    // Initialize collections with sample data if empty
    await initializeCollections();
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  }
}

// Initialize collections with sample data
async function initializeCollections() {
  try {
    // Initialize manga collection
    const mangaCount = await db.collection('manga').countDocuments();
    if (mangaCount === 0) {
      const sampleManga = require('./data/manga.json');
      await db.collection('manga').insertMany(sampleManga);
      console.log('Manga collection initialized with sample data');
    }

    // Initialize novels collection
    const novelsCount = await db.collection('novels').countDocuments();
    if (novelsCount === 0) {
      const sampleNovels = require('./data/novels.json');
      await db.collection('novels').insertMany(sampleNovels);
      console.log('Novels collection initialized with sample data');
    }

    // Initialize chapters collection
    const chaptersCount = await db.collection('chapters').countDocuments();
    if (chaptersCount === 0) {
      const sampleChapters = require('./data/chapters.json');
      
      // Convert chapters to array format for MongoDB
      const chaptersArray = [];
      for (const [normalizedTitle, chapters] of Object.entries(sampleChapters)) {
        for (const [chapterId, chapterData] of Object.entries(chapters)) {
          chaptersArray.push({
            normalizedTitle,
            chapterId,
            ...chapterData
          });
        }
      }
      
      if (chaptersArray.length > 0) {
        await db.collection('chapters').insertMany(chaptersArray);
        console.log('Chapters collection initialized with sample data');
      }
    }

    // Initialize users collection
    const usersCount = await db.collection('users').countDocuments();
    if (usersCount === 0) {
      const sampleUsers = require('./data/users.json');
      await db.collection('users').insertMany(sampleUsers);
      console.log('Users collection initialized with sample data');
    }

    // Initialize adsConfig collection
    const adsConfigCount = await db.collection('adsConfig').countDocuments();
    if (adsConfigCount === 0) {
      const sampleAdsConfig = require('./data/ads-config.json');
      await db.collection('adsConfig').insertOne(sampleAdsConfig);
      console.log('AdsConfig collection initialized with sample data');
    }
  } catch (err) {
    console.error('Error initializing collections:', err);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for ad completion (use a database in production)
const adCompletions = new Map();

// Combine all posts
let allPosts = [];

// Helper function to refresh allPosts
async function refreshAllPosts() {
  try {
    const manga = await db.collection('manga').find({}).toArray();
    const novels = await db.collection('novels').find({}).toArray();
    allPosts = [...manga, ...novels];
  } catch (err) {
    console.error('Error refreshing posts:', err);
  }
}

// API Routes
app.get('/api/data', async (req, res) => {
  try {
    await refreshAllPosts();
    res.json(allPosts);
  } catch (err) {
    console.error('Error fetching data:', err);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Get all manga and novels for admin
app.get('/api/manga', async (req, res) => {
  try {
    await refreshAllPosts();
    res.json(allPosts);
  } catch (err) {
    console.error('Error fetching manga:', err);
    res.status(500).json({ error: 'Failed to fetch manga' });
  }
});

// Get specific manga/novel by ID
app.get('/api/manga/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Search in both collections
    const manga = await db.collection('manga').findOne({ id });
    if (manga) {
      return res.json(manga);
    }
    
    const novel = await db.collection('novels').findOne({ id });
    if (novel) {
      return res.json(novel);
    }
    
    res.status(404).json({ error: 'Content not found' });
  } catch (err) {
    console.error('Error fetching content:', err);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// Add new manga/novel
app.post('/api/manga', async (req, res) => {
  try {
    const newPost = req.body;
    
    // Generate a new ID
    const maxMangaId = await db.collection('manga').find().sort({ id: -1 }).limit(1).toArray();
    const maxNovelId = await db.collection('novels').find().sort({ id: -1 }).limit(1).toArray();
    
    const maxId = Math.max(
      maxMangaId.length > 0 ? maxMangaId[0].id : 0,
      maxNovelId.length > 0 ? maxNovelId[0].id : 0,
      0
    );
    
    newPost.id = maxId + 1;
    newPost.created_at = new Date().toISOString();
    
    // Add to the appropriate collection
    if (newPost.type === 'manga') {
      await db.collection('manga').insertOne(newPost);
    } else {
      await db.collection('novels').insertOne(newPost);
    }
    
    // Update allPosts
    await refreshAllPosts();
    
    res.json({ success: true, id: newPost.id });
  } catch (err) {
    console.error('Error creating content:', err);
    res.status(500).json({ error: 'Failed to create content' });
  }
});

// Update manga/novel
app.put('/api/manga/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updatedData = req.body;
    
    // Update in the appropriate collection
    const mangaResult = await db.collection('manga').updateOne(
      { id },
      { $set: updatedData }
    );
    
    if (mangaResult.matchedCount === 0) {
      const novelResult = await db.collection('novels').updateOne(
        { id },
        { $set: updatedData }
      );
      
      if (novelResult.matchedCount === 0) {
        return res.status(404).json({ error: 'Content not found' });
      }
    }
    
    // Update allPosts
    await refreshAllPosts();
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating content:', err);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// Get chapters for a specific manga/novel
app.get('/api/manga/:id/chapters', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Find the post to get the title
    const manga = await db.collection('manga').findOne({ id });
    const novel = await db.collection('novels').findOne({ id });
    
    const post = manga || novel;
    if (!post) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    // Get the normalized title for chapters lookup
    const normalizedTitle = post.title.toLowerCase().replace(/\s+/g, '-');
    const chapters = await db.collection('chapters').find({ normalizedTitle }).toArray();
    
    // Convert to object format for compatibility
    const chaptersObj = {};
    chapters.forEach(chapter => {
      chaptersObj[chapter.chapterId] = {
        title: chapter.title,
        pages: chapter.pages || [],
        content: chapter.content || null
      };
    });
    
    res.json(chaptersObj);
  } catch (err) {
    console.error('Error fetching chapters:', err);
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

// Add chapter to manga/novel
app.post('/api/manga/:id/chapters', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Find the post to get the title
    const manga = await db.collection('manga').findOne({ id });
    const novel = await db.collection('novels').findOne({ id });
    
    const post = manga || novel;
    if (!post) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    const { chapterId, title, pages, content } = req.body;
    const normalizedTitle = post.title.toLowerCase().replace(/\s+/g, '-');
    
    // Check if chapter already exists
    const existingChapter = await db.collection('chapters').findOne({ 
      normalizedTitle, 
      chapterId 
    });
    
    if (existingChapter) {
      // Update existing chapter
      await db.collection('chapters').updateOne(
        { normalizedTitle, chapterId },
        { $set: { title, pages, content } }
      );
    } else {
      // Insert new chapter
      await db.collection('chapters').insertOne({
        normalizedTitle,
        chapterId,
        title,
        pages: pages || [],
        content: content || null
      });
    }
    
    // Update chapters count in the main post
    const chaptersCount = await db.collection('chapters').countDocuments({ normalizedTitle });
    
    if (manga) {
      await db.collection('manga').updateOne(
        { id },
        { $set: { chapters_count: chaptersCount } }
      );
    } else {
      await db.collection('novels').updateOne(
        { id },
        { $set: { chapters_count: chaptersCount } }
      );
    }
    
    // Update allPosts
    await refreshAllPosts();
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error adding chapter:', err);
    res.status(500).json({ error: 'Failed to add chapter' });
  }
});

// Delete chapter
app.delete('/api/manga/:id/chapters/:chapterId', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const chapterId = req.params.chapterId;
    
    // Find the post to get the title
    const manga = await db.collection('manga').findOne({ id });
    const novel = await db.collection('novels').findOne({ id });
    
    const post = manga || novel;
    if (!post) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    const normalizedTitle = post.title.toLowerCase().replace(/\s+/g, '-');
    
    // Delete the chapter
    const result = await db.collection('chapters').deleteOne({ 
      normalizedTitle, 
      chapterId 
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Chapter not found' });
    }
    
    // Update chapters count in the main post
    const chaptersCount = await db.collection('chapters').countDocuments({ normalizedTitle });
    
    if (manga) {
      await db.collection('manga').updateOne(
        { id },
        { $set: { chapters_count: chaptersCount } }
      );
    } else {
      await db.collection('novels').updateOne(
        { id },
        { $set: { chapters_count: chaptersCount } }
      );
    }
    
    // Update allPosts
    await refreshAllPosts();
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting chapter:', err);
    res.status(500).json({ error: 'Failed to delete chapter' });
  }
});

// Delete manga/novel
app.delete('/api/manga/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Delete from manga or novels collection
    const mangaResult = await db.collection('manga').deleteOne({ id });
    
    if (mangaResult.deletedCount === 0) {
      const novelResult = await db.collection('novels').deleteOne({ id });
      
      if (novelResult.deletedCount === 0) {
        return res.status(404).json({ error: 'Content not found' });
      }
    }
    
    // Update allPosts
    await refreshAllPosts();
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting content:', err);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// Get ads configuration
app.get('/api/ads-config', async (req, res) => {
  try {
    const config = await db.collection('adsConfig').findOne({});
    res.json(config || {
      enabled: true,
      adUnits: {
        BANNER: 'ca-app-pub-3940256099942544/9257395921',
        INTERSTITIAL: 'ca-app-pub-3940256099942544/1033173712',
        REWARDED: 'ca-app-pub-3940256099942544/5224354917',
        REWARDED_INTERSTITIAL: 'ca-app-pub-3940256099942544/5354046379'
      },
      adFrequency: {
        TAB_SWITCH: 0.3,
        CHAPTER_UNLOCK: 1.0
      }
    });
  } catch (err) {
    console.error('Error fetching ads config:', err);
    res.status(500).json({ error: 'Failed to fetch ads config' });
  }
});

// Update ads configuration (admin endpoint)
app.post('/api/ads-config', async (req, res) => {
  try {
    const { enabled, adUnits, adFrequency } = req.body;
    
    // Get current config
    const currentConfig = await db.collection('adsConfig').findOne({}) || {};
    
    // Update config
    const updatedConfig = {
      ...currentConfig,
      enabled: enabled !== undefined ? enabled : currentConfig.enabled,
      adUnits: adUnits ? { ...currentConfig.adUnits, ...adUnits } : currentConfig.adUnits,
      adFrequency: adFrequency ? { ...currentConfig.adFrequency, ...adFrequency } : currentConfig.adFrequency
    };
    
    // Upsert the config
    await db.collection('adsConfig').updateOne(
      {},
      { $set: updatedConfig },
      { upsert: true }
    );
    
    res.json({ success: true, config: updatedConfig });
  } catch (err) {
    console.error('Error updating ads config:', err);
    res.status(500).json({ error: 'Failed to update ads config' });
  }
});

// Generate guest user
app.post('/api/guest-user', async (req, res) => {
  try {
    const guestId = uuidv4();
    const userAgent = req.get('User-Agent') || 'Unknown';
    
    const newUser = {
      id: guestId,
      name: `Guest-${guestId.substring(0, 8)}`,
      role: 'guest',
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      user_agent: userAgent
    };
    
    await db.collection('users').insertOne(newUser);
    
    res.json({ success: true, user: newUser });
  } catch (err) {
    console.error('Error creating guest user:', err);
    res.status(500).json({ error: 'Failed to create guest user' });
  }
});

// Get users list
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.collection('users').find({}).toArray();
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Delete user
app.delete('/api/users/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const result = await db.collection('users').deleteOne({ id });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Mark ad as completed - MODIFIED WITH ERROR HANDLING
app.post('/ads-complete', async (req, res) => {
  try {
    const { userId, manga, chapterId } = req.body;
    
    if (!userId || !manga || !chapterId) {
      console.log('Missing required fields for ad completion');
      // Instead of returning error, we'll still mark as success
      // to allow chapter access even if ad verification fails
      return res.json({ success: true, message: 'Ad marked as completed (bypassed)' });
    }
    
    const key = `${userId}-${manga}-${chapterId}`;
    adCompletions.set(key, true);
    
    // Update user last seen
    await db.collection('users').updateOne(
      { id: userId },
      { $set: { last_seen: new Date().toISOString() } }
    );
    
    res.json({ success: true, message: 'Ad marked as completed' });
  } catch (error) {
    console.error('Error in ad completion:', error);
    // Even if there's an error, return success to allow chapter access
    res.json({ success: true, message: 'Ad verification bypassed due to error' });
  }
});

// Get chapter content with ad verification - MODIFIED WITH FALLBACK
app.get('/chapter/:manga/:chapterId', async (req, res) => {
  try {
    const { manga, chapterId } = req.params;
    const userId = req.query.user || 'guest';
    
    // Check if ad was completed for this chapter
    const key = `${userId}-${manga}-${chapterId}`;
    
    // If ad was not completed, check if we should allow access anyway
    // after a certain time or based on other conditions
    if (!adCompletions.has(key)) {
      console.log(`Ad not completed for ${key}, but allowing access with fallback`);
      // We'll still allow access but log this for analytics
    }
    
    // Find the chapter data
    const chapter = await db.collection('chapters').findOne({
      normalizedTitle: manga,
      chapterId: chapterId
    });
    
    if (chapter) {
      res.json({
        title: chapter.title,
        pages: chapter.pages || [],
        content: chapter.content || null
      });
    } else {
      res.status(404).json({ error: 'Chapter not found' });
    }
  } catch (error) {
    console.error('Error fetching chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// NEW API: Direct chapter access without ad verification (for fallback)
app.get('/direct-chapter/:manga/:chapterId', async (req, res) => {
  try {
    const { manga, chapterId } = req.params;
    
    const chapter = await db.collection('chapters').findOne({
      normalizedTitle: manga,
      chapterId: chapterId
    });
    
    if (chapter) {
      res.json({
        title: chapter.title,
        pages: chapter.pages || [],
        content: chapter.content || null
      });
    } else {
      res.status(404).json({ error: 'Chapter not found' });
    }
  } catch (error) {
    console.error('Error fetching chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Create data directory if it doesn't exist
(async () => {
  try {
    const fs = require('fs').promises;
    await fs.mkdir('./data', { recursive: true });
    
    // Initialize files if they don't exist
    const files = [
      { path: './data/manga.json', default: '[]' },
      { path: './data/novels.json', default: '[]' },
      { path: './data/chapters.json', default: '{}' },
      { path: './data/users.json', default: '[]' },
      { path: './data/ads-config.json', default: '{}' }
    ];
    
    for (const file of files) {
      try {
        await fs.access(file.path);
      } catch {
        await fs.writeFile(file.path, file.default);
      }
    }
  } catch (err) {
    console.error('Error creating data directory:', err);
  }
})();

// Connect to MongoDB and start server
connectToMongo().then(() => {
  app.listen(PORT, () => {
    console.log(`Rovel server running on port ${PORT}`);
    console.log(`Admin panel available at /admin`);
    console.log(`MongoDB connected to ${MONGO_URL}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  if (client) {
    await client.close();
  }
  process.exit(0);
});