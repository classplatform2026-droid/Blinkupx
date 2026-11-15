import bcrypt from 'bcryptjs';
import { User } from '../models/User.ts';

interface DemoUserSeed {
  fullName: string;
  username: string;
  phone: string;
  email: string;
  password: string;
  bio: string;
}

const DEMO_USERS: DemoUserSeed[] = [
  {
    fullName: 'Aarav Rahman',
    username: 'aarav_demo',
    phone: '01700000001',
    email: 'aarav.demo@blinkupz.app',
    password: 'Demo@1234',
    bio: 'Product designer & BlinkUpZ demo account.',
  },
  {
    fullName: 'Nadia Karim',
    username: 'nadia_demo',
    phone: '01800000002',
    email: 'nadia.demo@blinkupz.app',
    password: 'Demo@1234',
    bio: 'Full-stack developer & BlinkUpZ demo account.',
  },
];

let seeded = false;

export async function ensureDemoUsers(): Promise<void> {
  if (seeded) return;

  for (const entry of DEMO_USERS) {
    const existing = await User.findOne({
      $or: [
        { username: entry.username },
        { phone: entry.phone },
        { email: entry.email },
      ],
    }).select('_id');

    if (!existing) {
      const passwordHash = await bcrypt.hash(entry.password, 12);
      await User.create({
        fullName: entry.fullName,
        username: entry.username,
        phone: entry.phone,
        email: entry.email,
        passwordHash,
        bio: entry.bio,
        isVerified: true,
        onlineStatus: false,
        lastSeen: new Date(),
      });
    }
  }

  seeded = true;
}
