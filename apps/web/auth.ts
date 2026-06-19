import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getPrismaClient } from "@/server/db/prisma";
import { safeVerifySessionGrant } from "@/server/auth/challenge";

const sessionGrantSchema = z.object({
  sessionGrant: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    Credentials({
      credentials: {
        sessionGrant: {
          label: "Session grant",
          type: "text",
        },
      },
      async authorize(credentials) {
        const parsed = sessionGrantSchema.safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        const payload = safeVerifySessionGrant(parsed.data.sessionGrant);

        if (!payload) {
          return null;
        }

        const prisma = getPrismaClient();
        const user = await prisma.user.findUnique({
          where: {
            id: payload.userId,
          },
          select: {
            id: true,
            email: true,
            name: true,
            twoFactorEnabled: true,
          },
        });

        if (!user || !user.twoFactorEnabled) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      return session;
    },
  },
});
