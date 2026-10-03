import type { Category } from '../../src/shared/types';

/**
 * English answer bank, written for this project. Bots answer from it and the
 * automatic check uses it to mark answers as "In our list" (recognised) — it is
 * a hint for voters, never a verdict. Names are common given names (no famous
 * people); places are real geography. Every entry passes the moderator and the
 * format rules, and every round letter has at least 5 entries per category
 * (tested in test/content.test.ts). The bank is server-only.
 */
export const BANK: Record<Category, Record<string, readonly string[]>> = {
  name: {
    A: ['Aarav', 'Ananya', 'Arjun', 'Aisha', 'Amit', 'Anjali'],
    B: ['Bhavna', 'Bilal', 'Bharat', 'Bina', 'Ben', 'Bella'],
    C: ['Chetan', 'Chitra', 'Charu', 'Chandan', 'Clara', 'Carlos'],
    D: ['Deepak', 'Divya', 'Dev', 'Diya', 'Daniel', 'Dina'],
    E: ['Esha', 'Ekta', 'Eshan', 'Emma', 'Ethan', 'Elena'],
    F: ['Farah', 'Faisal', 'Fatima', 'Firoz', 'Felix', 'Fiona'],
    G: ['Gaurav', 'Gita', 'Gauri', 'Govind', 'Grace', 'George'],
    H: ['Harsh', 'Hema', 'Hari', 'Heena', 'Hannah', 'Henry'],
    I: ['Isha', 'Ishaan', 'Irfan', 'Ira', 'Imran', 'Ivy'],
    J: ['Jaya', 'Jatin', 'Jasmine', 'Jai', 'Jyoti', 'James'],
    K: ['Kavya', 'Karan', 'Kiran', 'Kabir', 'Kriti', 'Kunal'],
    L: ['Lata', 'Lakshmi', 'Laila', 'Lalit', 'Leo', 'Lucy'],
    M: ['Meera', 'Manish', 'Mohan', 'Maya', 'Mira', 'Max'],
    N: ['Neha', 'Nikhil', 'Naina', 'Nitin', 'Nora', 'Noah'],
    O: ['Om', 'Ojas', 'Omar', 'Olivia', 'Oscar', 'Ojasvi'],
    P: ['Priya', 'Pooja', 'Pranav', 'Parth', 'Pallavi', 'Prakash'],
    R: ['Rahul', 'Riya', 'Rohan', 'Ritu', 'Ravi', 'Rosa'],
    S: ['Sneha', 'Sameer', 'Sana', 'Suresh', 'Sara', 'Sam'],
    T: ['Tanvi', 'Tarun', 'Tara', 'Tushar', 'Tina', 'Tom'],
    U: ['Uday', 'Uma', 'Usha', 'Utkarsh', 'Urvi', 'Umar'],
    V: ['Varun', 'Vidya', 'Vikram', 'Vani', 'Vivek', 'Vera'],
    W: ['Wasim', 'Waheeda', 'Wendy', 'William', 'Wahid', 'Willow'],
    Y: ['Yash', 'Yamini', 'Yusuf', 'Yogesh', 'Yasmin', 'Yuvraj'],
  },
  place: {
    A: ['Agra', 'Ahmedabad', 'Assam', 'Australia', 'Amritsar', 'Athens'],
    B: ['Bengaluru', 'Bhopal', 'Bihar', 'Brazil', 'Berlin', 'Bangkok'],
    C: ['Chennai', 'Chandigarh', 'Canada', 'China', 'Cairo', 'Coimbatore'],
    D: ['Delhi', 'Dehradun', 'Darjeeling', 'Denmark', 'Dubai', 'Dhaka'],
    E: ['Egypt', 'England', 'Ernakulam', 'Estonia', 'Edinburgh', 'Ethiopia'],
    F: ['France', 'Faridabad', 'Finland', 'Fiji', 'Florence', 'Firozabad'],
    G: ['Goa', 'Gujarat', 'Guwahati', 'Germany', 'Ghana', 'Gwalior'],
    H: ['Hyderabad', 'Haridwar', 'Himachal Pradesh', 'Hungary', 'Hong Kong', 'Hampi'],
    I: ['India', 'Indore', 'Imphal', 'Italy', 'Iceland', 'Iran'],
    J: ['Jaipur', 'Jodhpur', 'Jammu', 'Japan', 'Jakarta', 'Jharkhand'],
    K: ['Kolkata', 'Kochi', 'Kanpur', 'Kenya', 'Kerala', 'Kathmandu'],
    L: ['Lucknow', 'Ladakh', 'London', 'Lisbon', 'Leh', 'Lebanon'],
    M: ['Mumbai', 'Mysuru', 'Madurai', 'Mexico', 'Manali', 'Moscow'],
    N: ['Nagpur', 'Nashik', 'Nepal', 'Norway', 'Nairobi', 'Noida'],
    O: ['Odisha', 'Ooty', 'Oman', 'Oslo', 'Ottawa', 'Orchha'],
    P: ['Pune', 'Patna', 'Punjab', 'Paris', 'Peru', 'Puducherry'],
    R: ['Rajasthan', 'Ranchi', 'Rishikesh', 'Rome', 'Russia', 'Raipur'],
    S: ['Shimla', 'Surat', 'Sikkim', 'Spain', 'Singapore', 'Srinagar'],
    T: ['Thane', 'Tamil Nadu', 'Thailand', 'Tokyo', 'Tirupati', 'Turkey'],
    U: ['Udaipur', 'Ujjain', 'Uttarakhand', 'Uganda', 'Ukraine', 'Uruguay'],
    V: ['Varanasi', 'Vadodara', 'Vellore', 'Vietnam', 'Venice', 'Vienna'],
    W: ['Warangal', 'Wayanad', 'Wales', 'Warsaw', 'Washington', 'Wellington'],
    Y: ['Yemen', 'Yangon', 'Yokohama', 'Yercaud', 'Yamunanagar', 'York'],
  },
  animal: {
    A: ['Ant', 'Antelope', 'Alligator', 'Armadillo', 'Ape', 'Alpaca'],
    B: ['Bear', 'Buffalo', 'Bat', 'Bee', 'Bison', 'Butterfly'],
    C: ['Cat', 'Camel', 'Cheetah', 'Cow', 'Crocodile', 'Crow'],
    D: ['Dog', 'Deer', 'Dolphin', 'Donkey', 'Duck', 'Dove'],
    E: ['Elephant', 'Eagle', 'Eel', 'Emu', 'Elk', 'Earthworm'],
    F: ['Fox', 'Frog', 'Fish', 'Flamingo', 'Falcon', 'Ferret'],
    G: ['Goat', 'Giraffe', 'Gorilla', 'Gecko', 'Goose', 'Gaur'],
    H: ['Horse', 'Hippo', 'Hen', 'Hyena', 'Hedgehog', 'Hornbill'],
    I: ['Ibex', 'Ibis', 'Iguana', 'Impala', 'Indri', 'Inchworm'],
    J: ['Jaguar', 'Jackal', 'Jellyfish', 'Jay', 'Jerboa', 'Jackdaw'],
    K: ['Kangaroo', 'Koala', 'Kingfisher', 'Kiwi', 'Kudu', 'Koel'],
    L: ['Lion', 'Leopard', 'Lizard', 'Lamb', 'Llama', 'Lobster'],
    M: ['Monkey', 'Mouse', 'Mongoose', 'Moose', 'Mole', 'Mosquito'],
    N: ['Newt', 'Nightingale', 'Narwhal', 'Nilgai', 'Numbat', 'Nightjar'],
    O: ['Owl', 'Otter', 'Ostrich', 'Octopus', 'Orangutan', 'Ox'],
    P: ['Peacock', 'Parrot', 'Panda', 'Pig', 'Penguin', 'Python'],
    R: ['Rabbit', 'Rat', 'Rhino', 'Reindeer', 'Raccoon', 'Robin'],
    S: ['Snake', 'Sparrow', 'Squirrel', 'Shark', 'Sheep', 'Swan'],
    T: ['Tiger', 'Tortoise', 'Turtle', 'Toucan', 'Termite', 'Toad'],
    U: ['Urial', 'Uakari', 'Umbrellabird', 'Urchin', 'Unicornfish', 'Uromastyx'],
    V: ['Vulture', 'Viper', 'Vole', 'Vicuna', 'Vervet', 'Vampire bat'],
    W: ['Wolf', 'Whale', 'Walrus', 'Woodpecker', 'Wombat', 'Wasp'],
    Y: ['Yak', 'Yabby', 'Yellowhammer', 'Yapok', 'Yellowjacket', 'Yellowfin tuna'],
  },
  thing: {
    A: ['Apron', 'Anchor', 'Axe', 'Alarm clock', 'Album', 'Arrow'],
    B: ['Ball', 'Bag', 'Book', 'Bottle', 'Bucket', 'Brush'],
    C: ['Chair', 'Cup', 'Clock', 'Candle', 'Comb', 'Camera'],
    D: ['Desk', 'Drum', 'Door', 'Diary', 'Doll', 'Duster'],
    E: ['Eraser', 'Envelope', 'Earphones', 'Easel', 'Engine', 'Elevator'],
    F: ['Fan', 'Fork', 'Flag', 'Flute', 'Frame', 'Fridge'],
    G: ['Glass', 'Guitar', 'Glove', 'Globe', 'Gate', 'Glue'],
    H: ['Hat', 'Hammer', 'Helmet', 'Hanger', 'Harmonium', 'Headphones'],
    I: ['Iron', 'Ink', 'Igloo', 'Inkpot', 'Ice pack', 'Index card'],
    J: ['Jar', 'Jacket', 'Jug', 'Jeans', 'Jigsaw puzzle', 'Juicer'],
    K: ['Kite', 'Key', 'Kettle', 'Knife', 'Keyboard', 'Kurta'],
    L: ['Lamp', 'Lock', 'Ladder', 'Laptop', 'Lunchbox', 'Lantern'],
    M: ['Mirror', 'Mug', 'Map', 'Marker', 'Mat', 'Mobile phone'],
    N: ['Needle', 'Notebook', 'Net', 'Nail', 'Necklace', 'Napkin'],
    O: ['Oven', 'Oar', 'Ornament', 'Overcoat', 'Organ', 'Oil lamp'],
    P: ['Pen', 'Pencil', 'Plate', 'Pillow', 'Purse', 'Phone'],
    R: ['Ruler', 'Rope', 'Radio', 'Ring', 'Rug', 'Remote'],
    S: ['Spoon', 'Scissors', 'Sofa', 'Shoe', 'Sharpener', 'Saree'],
    T: ['Table', 'Torch', 'Towel', 'Television', 'Tent', 'Tiffin box'],
    U: ['Umbrella', 'Uniform', 'Utensil', 'Ukulele', 'Unicycle', 'Urn'],
    V: ['Vase', 'Violin', 'Van', 'Vacuum cleaner', 'Vest', 'Veena'],
    W: ['Watch', 'Wallet', 'Window', 'Whistle', 'Wheel', 'Wardrobe'],
    Y: ['Yo-yo', 'Yarn', 'Yardstick', 'Yacht', 'Yoga mat', 'Yoke'],
  },
};

/**
 * Accepted variants that count as the same answer (each list shares its first
 * letter — answers with different letters can never meet). The first entry is
 * the canonical one. Variants are recognised answers too.
 */
export const ALIASES: Record<Category, readonly (readonly string[])[]> = {
  name: [],
  place: [
    ['Bengaluru', 'Bangalore'],
    ['Mysuru', 'Mysore'],
    ['Puducherry', 'Pondicherry'],
    ['Odisha', 'Orissa'],
    ['Gurugram', 'Gurgaon'],
    ['Thiruvananthapuram', 'Trivandrum'],
  ],
  animal: [
    ['Hippo', 'Hippopotamus'],
    ['Rhino', 'Rhinoceros'],
  ],
  thing: [
    ['Television', 'TV'],
    ['Mobile phone', 'Mobile'],
  ],
};
