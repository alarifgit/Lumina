// Lumina seed — curated real movie/TV metadata + playable sample streams.
// Run: `bun scripts/seed.ts`  (idempotent — wipes & re-creates demo content)

import { db } from "../src/lib/db";

const SAMPLE_VIDEOS = [
  "https://vjs.zencdn.net/v/oceans.mp4",
  "https://media.w3.org/2010/05/sintel/trailer.mp4",
  "https://www.w3schools.com/html/mov_bbb.mp4",
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
  "https://vjs.zencdn.net/v/oceans.mp4",
  "https://media.w3.org/2010/05/sintel/trailer.mp4",
];
const streamUrl = (i: number) => SAMPLE_VIDEOS[i % SAMPLE_VIDEOS.length];

// TMDB genre IDs (so future TMDB fetches align)
const GENRE_IDS: Record<string, number> = {
  Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99,
  Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402,
  Mystery: 9648, Romance: 10749, "Science Fiction": 878, Thriller: 53, War: 10752,
  Western: 37, "TV Movie": 10770,
  "Action & Adventure": 10759, "Sci-Fi & Fantasy": 10765, "War & Politics": 10768,
  Kids: 10762, News: 10763, Reality: 10764, Soap: 10766, Talk: 10767,
};

interface TitleSeed {
  type: "MOVIE" | "TV";
  title: string;
  year: number;
  rating: number;
  runtime: number;
  genres: string[];
  certification: string;
  tagline: string;
  overview: string;
  popularity: number;
  featured?: boolean;
  trending?: boolean;
  releaseDate: string;
  status: string;
  episodes?: { title: string; overview: string; runtime: number }[];
}

const DATA: TitleSeed[] = [
  {
    type: "MOVIE", title: "The Dark Knight", year: 2008, rating: 9.0, runtime: 152,
    genres: ["Action", "Crime", "Drama"], certification: "R",
    tagline: "Why so serious?",
    overview: "Batman raises the stakes in his war on crime. With the help of Lt. Jim Gordon and District Attorney Harvey Dent, Batman sets out to dismantle the remaining criminal organizations that plague the streets. The partnership proves to be effective, but they soon find themselves prey to a reign of chaos unleashed by a rising criminal mastermind known to the terrified citizens of Gotham as the Joker.",
    popularity: 98.7, featured: true, trending: true, releaseDate: "2008-07-16", status: "Released",
  },
  {
    type: "MOVIE", title: "Inception", year: 2010, rating: 8.4, runtime: 148,
    genres: ["Action", "Science Fiction", "Adventure"], certification: "PG-13",
    tagline: "Your mind is the scene of the crime.",
    overview: "A skilled thief who commits corporate espionage by infiltrating the subconscious of his targets is offered a chance to regain his old life as payment for a task considered to be impossible: inception, the implantation of another person's idea into a target's subconscious.",
    popularity: 88.2, trending: true, releaseDate: "2010-07-15", status: "Released",
  },
  {
    type: "MOVIE", title: "Interstellar", year: 2014, rating: 8.4, runtime: 169,
    genres: ["Adventure", "Drama", "Science Fiction"], certification: "PG-13",
    tagline: "Mankind was born on Earth. It was never meant to die here.",
    overview: "The adventures of a group of explorers who make use of a newly discovered rift in space-time to surpass the limits on human space travel and conquer the vast distances involved in an interstellar voyage.",
    popularity: 92.1, featured: true, trending: true, releaseDate: "2014-11-05", status: "Released",
  },
  {
    type: "MOVIE", title: "The Matrix", year: 1999, rating: 8.2, runtime: 136,
    genres: ["Action", "Science Fiction"], certification: "R",
    tagline: "Welcome to the Real World.",
    overview: "Set in the 22nd century, The Matrix tells the story of a computer hacker who joins a group of underground insurgents fighting the vast and powerful computers who now rule the earth.",
    popularity: 84.0, trending: true, releaseDate: "1999-03-30", status: "Released",
  },
  {
    type: "MOVIE", title: "Pulp Fiction", year: 1994, rating: 8.5, runtime: 154,
    genres: ["Thriller", "Crime"], certification: "R",
    tagline: "You won't know the facts until you've seen the fiction.",
    overview: "A burger-loving hit man, his philosophical partner, a drug-addled gangster's moll and a washed-up boxer converge in this sprawling, comedic crime caper. Their adventures unfurl in three stories that ingeniously trip back and forth in time.",
    popularity: 78.6, releaseDate: "1994-10-14", status: "Released",
  },
  {
    type: "MOVIE", title: "Fight Club", year: 1999, rating: 8.4, runtime: 139,
    genres: ["Drama"], certification: "R",
    tagline: "Mischief. Mayhem. Soap.",
    overview: "A ticking-time-bomb insomniac and a slippery soap salesman channel primal male aggression into a shocking new form of therapy. Their concept catches on, with underground fight clubs forming in every town, until a sensuous eccentric gets in the way and ignites an out-of-control spiral toward oblivion.",
    popularity: 76.3, releaseDate: "1999-10-15", status: "Released",
  },
  {
    type: "MOVIE", title: "Forrest Gump", year: 1994, rating: 8.5, runtime: 142,
    genres: ["Comedy", "Drama", "Romance"], certification: "PG-13",
    tagline: "Life is like a box of chocolates... you never know what you're gonna get.",
    overview: "A man with a low IQ has accomplished great things in his life and been present during significant historic events—in each case, far exceeding what anyone imagined he could do. But despite all he has achieved, his one true love eludes him.",
    popularity: 80.1, releaseDate: "1994-07-06", status: "Released",
  },
  {
    type: "MOVIE", title: "The Godfather", year: 1972, rating: 8.7, runtime: 175,
    genres: ["Crime", "Drama"], certification: "R",
    tagline: "An offer you can't refuse.",
    overview: "Spanning the years 1945 to 1955, a chronicle of the fictional Italian-American Corleone crime family. When organized crime family patriarch, Vito Corleone barely survives an attempt on his life, his youngest son, Michael steps in to take care of the would-be killers, launching a campaign of bloody revenge.",
    popularity: 82.4, releaseDate: "1972-03-14", status: "Released",
  },
  {
    type: "MOVIE", title: "Gladiator", year: 2000, rating: 8.2, runtime: 155,
    genres: ["Action", "Adventure", "Drama"], certification: "R",
    tagline: "What we do in life echoes in eternity.",
    overview: "In the year 180, the death of emperor Marcus Aurelius throws the Roman Empire into chaos. Maximus is one of the Roman army's most capable and trusted generals and a key advisor to the emperor. Before his death, the emperor chooses Maximus to be his heir over his own son, Commodus, and a power struggle leaves Maximus and his family condemned to death.",
    popularity: 74.0, releaseDate: "2000-05-05", status: "Released",
  },
  {
    type: "MOVIE", title: "The Shawshank Redemption", year: 1994, rating: 8.7, runtime: 142,
    genres: ["Crime", "Drama"], certification: "R",
    tagline: "Fear can hold you prisoner. Hope can set you free.",
    overview: "Framed in the 1940s for the double murder of his wife and her lover, upstanding banker Andy Dufresne begins a new life at the Shawshank prison, where he puts his accounting skills to work for an amoral warden. During his long stretch in prison, Dufresne comes to be admired by the other inmates -- including an older prisoner named Red -- for his integrity and unquenchable sense of hope.",
    popularity: 86.9, trending: true, releaseDate: "1994-09-23", status: "Released",
  },
  {
    type: "MOVIE", title: "Dune", year: 2021, rating: 8.0, runtime: 155,
    genres: ["Science Fiction", "Adventure"], certification: "PG-13",
    tagline: "Beyond fear, destiny awaits.",
    overview: "Paul Atreides, a brilliant and gifted young man born into a great destiny beyond his understanding, must travel to the most dangerous planet in the universe to ensure the future of his family and his people. As malevolent forces explode into conflict over the planet's exclusive supply of the most precious resource in existence, only those who can conquer their fear will survive.",
    popularity: 95.4, featured: true, trending: true, releaseDate: "2021-09-15", status: "Released",
  },
  {
    type: "MOVIE", title: "Blade Runner 2049", year: 2017, rating: 8.0, runtime: 164,
    genres: ["Science Fiction", "Drama"], certification: "R",
    tagline: "The key to the future is finally unearthed.",
    overview: "Thirty years after the events of the first film, a new blade runner, LAPD Officer K, unearths a long-buried secret that has the potential to plunge what's left of society into chaos. K's discovery leads him on a quest to find Rick Deckard, a former LAPD blade runner who has been missing for thirty years.",
    popularity: 70.5, releaseDate: "2017-10-06", status: "Released",
  },
  {
    type: "MOVIE", title: "Mad Max: Fury Road", year: 2015, rating: 7.6, runtime: 120,
    genres: ["Action", "Adventure", "Science Fiction"], certification: "R",
    tagline: "What a lovely day.",
    overview: "An apocalyptic story set in the furthest reaches of our planet, in a stark desert landscape where humanity is broken, and most everyone is crazed fighting for the necessities of life. Within this world exist two rebels on the run who just might be able to restore order.",
    popularity: 72.8, releaseDate: "2015-05-15", status: "Released",
  },
  {
    type: "MOVIE", title: "Parasite", year: 2019, rating: 8.5, runtime: 132,
    genres: ["Comedy", "Thriller", "Drama"], certification: "R",
    tagline: "Act like you own the place.",
    overview: "All unemployed, Ki-taek's family takes peculiar interest in the wealthy and glamorous Parks for their livelihood until they get entangled in an unexpected incident.",
    popularity: 83.7, trending: true, releaseDate: "2019-05-30", status: "Released",
  },
  {
    type: "MOVIE", title: "Whiplash", year: 2014, rating: 8.4, runtime: 107,
    genres: ["Drama", "Music"], certification: "R",
    tagline: "The road to greatness can take you to the edge.",
    overview: "Under the direction of a ruthless instructor, a talented young drummer begins to pursue perfection at any cost, even his humanity.",
    popularity: 68.9, releaseDate: "2014-10-10", status: "Released",
  },
  {
    type: "MOVIE", title: "La La Land", year: 2016, rating: 7.9, runtime: 128,
    genres: ["Romance", "Comedy", "Drama", "Music"], certification: "PG-13",
    tagline: "Here's to the ones who dream.",
    overview: "Mia, an aspiring actress, serves lattes to movie stars in between auditions and Sebastian, a jazz musician, scrapes by playing cocktail party gigs in dingy bars, but as success mounts they are faced with decisions that begin to fray the fragile fabric of their love affair.",
    popularity: 71.2, releaseDate: "2016-12-09", status: "Released",
  },
  {
    type: "MOVIE", title: "Joker", year: 2019, rating: 8.2, runtime: 122,
    genres: ["Crime", "Thriller", "Drama"], certification: "R",
    tagline: "Put on a happy face.",
    overview: "During the 1980s, a failed stand-up comedian is driven insane and turns to a life of crime and chaos in Gotham City while becoming an infamous psychopathic crime figure.",
    popularity: 79.4, releaseDate: "2019-10-04", status: "Released",
  },
  {
    type: "MOVIE", title: "Spirited Away", year: 2001, rating: 8.5, runtime: 125,
    genres: ["Animation", "Family", "Fantasy"], certification: "PG",
    tagline: "The tunnel led Chihiro to a mysterious town...",
    overview: "A young girl, Chihiro, becomes trapped in a strange new world of spirits. When her parents undergo a mysterious transformation, she must call upon the courage she never knew she had to free her family.",
    popularity: 75.6, releaseDate: "2001-07-20", status: "Released",
  },
  {
    type: "TV", title: "Breaking Bad", year: 2008, rating: 9.5, runtime: 49,
    genres: ["Drama", "Crime"], certification: "TV-MA",
    tagline: "Remember my name.",
    overview: "When Walter White, a New Mexico chemistry teacher, is diagnosed with Stage III cancer and given a prognosis of only two years left to live, he becomes filled with a sense of fearlessness and an unrelenting desire to secure his family's financial future at any cost.",
    popularity: 96.8, featured: true, trending: true, releaseDate: "2008-01-20", status: "Ended",
    episodes: [
      { title: "Pilot", overview: "Walter White, a struggling high school chemistry teacher, is diagnosed with advanced lung cancer.", runtime: 58 },
      { title: "Cat's in the Bag...", overview: "Walt and Jesse attempt to tie up loose ends after their first deal goes terribly wrong.", runtime: 48 },
      { title: "...And the Bag's in the River", overview: "Walt is struggling with the decision to kill Krazy-8.", runtime: 48 },
      { title: "Cancer Man", overview: "Walt tells his family about his cancer diagnosis.", runtime: 48 },
      { title: "Gray Matter", overview: "Walt rejects an offer of financial help from his old friends.", runtime: 48 },
    ],
  },
  {
    type: "TV", title: "Game of Thrones", year: 2011, rating: 8.4, runtime: 60,
    genres: ["Sci-Fi & Fantasy", "Drama", "Action & Adventure"], certification: "TV-MA",
    tagline: "Winter is coming.",
    overview: "Seven noble families fight for control of the mythical land of Westeros. Friction between the houses leads to full-scale war. All while a very ancient evil awakens in the farthest north.",
    popularity: 91.5, featured: true, trending: true, releaseDate: "2011-04-17", status: "Ended",
    episodes: [
      { title: "Winter Is Coming", overview: "Jon Arryn, the Hand of the King, is dead. King Robert Baratheon plans to ask his oldest friend, Eddard Stark, to take Jon's place.", runtime: 62 },
      { title: "The Kingsroad", overview: "The Stark family braces for a cold winter approaching.", runtime: 56 },
      { title: "Lord Snow", overview: "Eddard begins his tenure as the King's Hand.", runtime: 58 },
      { title: "Cripples, Bastards, and Broken Things", overview: "Tyrion stops at Winterfell on his way home.", runtime: 56 },
      { title: "The Wolf and the Lion", overview: "Tensions rise as the Lannisters and Starks clash.", runtime: 54 },
    ],
  },
  {
    type: "TV", title: "Stranger Things", year: 2016, rating: 8.6, runtime: 51,
    genres: ["Sci-Fi & Fantasy", "Drama", "Mystery"], certification: "TV-14",
    tagline: "When friends go missing, the truth will be found.",
    overview: "When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces, and one strange little girl.",
    popularity: 94.2, featured: true, trending: true, releaseDate: "2016-07-15", status: "Returning Series",
    episodes: [
      { title: "The Vanishing of Will Byers", overview: "On his way home from a friend's house, young Will sees something terrifying.", runtime: 47 },
      { title: "The Weirdo on Maple Street", overview: "The boys befriend a girl with a shaved head and a strange tattoo.", runtime: 56 },
      { title: "Holly, Jolly", overview: "An increasingly concerned Nancy searches for Barb.", runtime: 52 },
      { title: "The Body", overview: "Jim Hopper discovers a connection to a government lab.", runtime: 51 },
      { title: "The Flea and the Acrobat", overview: "The group looks for the gate to the Upside Down.", runtime: 53 },
    ],
  },
  {
    type: "TV", title: "The Office", year: 2005, rating: 8.6, runtime: 22,
    genres: ["Comedy"], certification: "TV-14",
    tagline: "An everyday office, an anything-but-everyday comedy.",
    overview: "The everyday lives of office employees in the Scranton, Pennsylvania branch of the fictional Dunder Mifflin Paper Company.",
    popularity: 87.3, trending: true, releaseDate: "2005-03-24", status: "Ended",
    episodes: [
      { title: "Pilot", overview: "A documentary crew arrives at Dunder Mifflin.", runtime: 22 },
      { title: "Diversity Day", overview: "Michael conducts a misguided diversity training session.", runtime: 22 },
      { title: "Health Care", overview: "Dwight is tasked with choosing a new health care plan.", runtime: 22 },
      { title: "The Alliance", overview: "Jim convinces Dwight an alliance is needed.", runtime: 22 },
      { title: "Basketball", overview: "Michael pits the warehouse against the office in basketball.", runtime: 22 },
    ],
  },
  {
    type: "TV", title: "Chernobyl", year: 2019, rating: 8.7, runtime: 60,
    genres: ["Drama", "History", "War & Politics"], certification: "TV-MA",
    tagline: "What is the cost of lies?",
    overview: "In April 1986, an explosion at the Chernobyl nuclear power plant in the Union of Soviet Socialist Republics becomes one of the world's worst man-made catastrophes.",
    popularity: 81.9, trending: true, releaseDate: "2019-05-06", status: "Ended",
    episodes: [
      { title: "1:23-45", overview: "Plant workers and firefighters put their lives on the line.", runtime: 58 },
      { title: "Please Remain Calm", overview: "Evacuation begins as the scale of the disaster grows.", runtime: 65 },
      { title: "Open Wide, O Earth", overview: "Liquidators are sent to the roof.", runtime: 67 },
      { title: "The Happiness of All Mankind", overview: "The cleanup of the exclusion zone begins.", runtime: 66 },
      { title: "Vichnaya Pamyat", overview: "The truth is revealed in a trial.", runtime: 72 },
    ],
  },
  {
    type: "TV", title: "The Mandalorian", year: 2019, rating: 8.0, runtime: 40,
    genres: ["Sci-Fi & Fantasy", "Action & Adventure", "Western"], certification: "TV-14",
    tagline: "Bounty hunting is a dangerous profession.",
    overview: "After the fall of the Empire and before the emergence of the First Order, the adventures of a lone gunfighter in the outer reaches of the galaxy.",
    popularity: 85.6, trending: true, releaseDate: "2019-11-12", status: "Returning Series",
    episodes: [
      { title: "Chapter 1: The Mandalorian", overview: "A Mandalorian bounty hunter tracks a target.", runtime: 39 },
      { title: "Chapter 2: The Child", overview: "The Mandalorian protects his mysterious bounty.", runtime: 32 },
      { title: "Chapter 3: The Sin", overview: "The Mandalorian returns to his people.", runtime: 41 },
      { title: "Chapter 4: Sanctuary", overview: "On a quiet planet, the Mandalorian finds temporary peace.", runtime: 49 },
      { title: "Chapter 5: The Gunslinger", overview: "A familiar desert planet holds new dangers.", runtime: 35 },
    ],
  },
  {
    type: "TV", title: "Succession", year: 2018, rating: 8.4, runtime: 60,
    genres: ["Drama", "Comedy"], certification: "TV-MA",
    tagline: "Money wins.",
    overview: "The lives of the Roy family as they contend for their father's approval and control of his media empire after he steps back from day-to-day operations.",
    popularity: 77.1, releaseDate: "2018-06-03", status: "Ended",
    episodes: [
      { title: "Celebration", overview: "The Roy family gathers for Logan's 80th birthday.", runtime: 63 },
      { title: "Shit Show at the Fuck Factory", overview: "Kendall struggles to assert control.", runtime: 57 },
      { title: "Lifeboats", overview: "Tensions rise during a company retreat.", runtime: 58 },
      { title: "Sad Sack Wasp Trap", overview: "An old rival reappears.", runtime: 56 },
      { title: "I Went to Market", overview: "Logan considers a major move.", runtime: 59 },
    ],
  },
  {
    type: "TV", title: "Better Call Saul", year: 2015, rating: 8.4, runtime: 46,
    genres: ["Crime", "Drama"], certification: "TV-MA",
    tagline: "Make the call.",
    overview: "Six years before Saul Goodman meets Walter White, we meet him when the man who will become Saul Goodman is known as Jimmy McGill, a small-time lawyer struggling to make ends meet.",
    popularity: 73.8, releaseDate: "2015-02-08", status: "Ended",
    episodes: [
      { title: "Uno", overview: "Jimmy McGill takes on a case that could change everything.", runtime: 53 },
      { title: "Mijo", overview: "Jimmy finds himself in trouble with the cartel.", runtime: 47 },
      { title: "Nacho", overview: "Jimmy attempts to right a wrong.", runtime: 47 },
      { title: "Hero", overview: "Jimmy's billboard stunt goes viral.", runtime: 47 },
      { title: "Alpine Shepherd Boy", overview: "Jimmy takes on unusual clients.", runtime: 47 },
    ],
  },
  {
    type: "TV", title: "The Crown", year: 2016, rating: 8.2, runtime: 58,
    genres: ["Drama", "History"], certification: "TV-MA",
    tagline: "The crown must win.",
    overview: "The gripping, decades-spanning inside story of Her Majesty Queen Elizabeth II and the Prime Ministers who shaped Britain's post-war destiny.",
    popularity: 69.4, releaseDate: "2016-11-04", status: "Ended",
    episodes: [
      { title: "Wolferton Splash", overview: "Princess Elizabeth marries Philip Mountbatten.", runtime: 61 },
      { title: "Hyde Park Corner", overview: "The King's health declines.", runtime: 57 },
      { title: "Windsor", overview: "Elizabeth faces her first crisis as monarch.", runtime: 56 },
      { title: "Act of God", overview: "The Great Smog engulfs London.", runtime: 58 },
      { title: "Smoke and Mirrors", overview: "Philip's coronation role is debated.", runtime: 57 },
    ],
  },
  {
    type: "TV", title: "Westworld", year: 2016, rating: 8.0, runtime: 62,
    genres: ["Sci-Fi & Fantasy", "Western", "Drama"], certification: "TV-MA",
    tagline: "These violent delights have violent ends.",
    overview: "A Western-themed futuristic theme park, populated by artificial intelligence, allows guests to live out their fantasies but the androids begin to gain consciousness.",
    popularity: 70.8, releaseDate: "2016-10-02", status: "Ended",
    episodes: [
      { title: "The Original", overview: "A malfunction creates havoc in Westworld.", runtime: 68 },
      { title: "Chestnut", overview: "A new guest arrives at the park.", runtime: 60 },
      { title: "The Stray", overview: "The team hunts a stray host.", runtime: 60 },
      { title: "Dissonance Theory", overview: "Dolores joins William on a new journey.", runtime: 58 },
      { title: "Contrapasso", overview: "The Man in Black closes in on a secret.", runtime: 57 },
    ],
  },
];

async function main() {
  console.log("Clearing existing data...");
  await db.watchProgress.deleteMany();
  await db.collectionItem.deleteMany();
  await db.collection.deleteMany();
  await db.episode.deleteMany();
  await db.mediaGenre.deleteMany();
  await db.media.deleteMany();
  await db.genre.deleteMany();
  await db.libraryConfig.deleteMany();

  console.log("Creating genres...");
  const usedGenres = new Set<string>();
  for (const t of DATA) for (const g of t.genres) usedGenres.add(g);
  for (const name of usedGenres) {
    await db.genre.create({ data: { id: GENRE_IDS[name], name } });
  }

  console.log(`Creating ${DATA.length} titles...`);
  let streamIdx = 0;
  const createdMedia: { id: string; title: string; type: string }[] = [];

  for (const t of DATA) {
    const isMovie = t.type === "MOVIE";
    const media = await db.media.create({
      data: {
        type: t.type,
        title: t.title,
        sortTitle: t.title.toLowerCase(),
        overview: t.overview,
        tagline: t.tagline,
        year: t.year,
        releaseDate: new Date(t.releaseDate),
        runtime: t.runtime,
        rating: t.rating,
        voteCount: Math.round(t.popularity * 1000),
        status: t.status,
        certification: t.certification,
        featured: !!t.featured,
        trending: !!t.trending,
        popularity: t.popularity,
        streamUrl: isMovie ? streamUrl(streamIdx) : null,
        filePath: isMovie ? `/media/${t.title} (${t.year}).mp4` : `/media/${t.title}`,
        genres: {
          create: t.genres.map((g) => ({ genre: { connect: { name: g } } })),
        },
      },
    });
    createdMedia.push({ id: media.id, title: t.title, type: t.type });

    if (!isMovie && t.episodes) {
      for (let i = 0; i < t.episodes.length; i++) {
        const ep = t.episodes[i];
        await db.episode.create({
          data: {
            mediaId: media.id,
            seasonNumber: 1,
            episodeNumber: i + 1,
            title: ep.title,
            overview: ep.overview,
            runtime: ep.runtime,
            airDate: new Date(t.releaseDate),
            streamUrl: streamUrl(streamIdx + i),
          },
        });
      }
    }
    streamIdx++;
  }

  console.log("Seeding watch progress...");
  const progressSeeds = [
    { title: "The Dark Knight", episode: null as number | null, position: 2700, duration: 9120 },
    { title: "Interstellar", episode: null, position: 5400, duration: 10140 },
    { title: "Dune", episode: null, position: 1200, duration: 9300 },
    { title: "Breaking Bad", episode: 2, position: 1440, duration: 2880 },
    { title: "Stranger Things", episode: 1, position: 900, duration: 2820 },
    { title: "Game of Thrones", episode: 3, position: 2100, duration: 3480 },
  ];
  for (const ps of progressSeeds) {
    const media = createdMedia.find((m) => m.title === ps.title);
    if (!media) continue;
    let episodeId: string | null = null;
    if (ps.episode) {
      const ep = await db.episode.findFirst({
        where: { mediaId: media.id, seasonNumber: 1, episodeNumber: ps.episode },
      });
      episodeId = ep?.id ?? null;
    }
    await db.watchProgress.create({
      data: {
        mediaId: media.id,
        episodeId,
        position: ps.position,
        duration: ps.duration,
        completed: false,
        updatedAt: new Date(Date.now() - Math.random() * 3 * 86400000),
      },
    });
  }

  console.log("Seeding My List...");
  const myList = await db.collection.create({ data: { name: "My List", slug: "my-list" } });
  for (const title of ["The Godfather", "Parasite", "The Mandalorian", "Chernobyl"]) {
    const m = createdMedia.find((x) => x.title === title);
    if (m) await db.collectionItem.create({ data: { collectionId: myList.id, mediaId: m.id } });
  }

  await db.libraryConfig.create({
    data: { id: "default", mediaDir: process.env.MEDIA_DIR ?? "/media", scanCount: 0 },
  });

  console.log(`Done. Created ${createdMedia.length} titles.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
