import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middleware/auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
const ALLOWED_ORIGINS = [
  "https://demo.thehit.in",
  "https://www.thehit.in",
  "https://thehit.in",
  "http://localhost:3004",
  "http://localhost:5173",
  "http://localhost:5174",
];

app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);


app.get("/health", (_req, res) => {
  res.json({ message: "ok" });
});


app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use("/api", router);

app.get("/", (_req, res) => {
  res.json({ message: "Welcome to the TheHit API" });
});



export default app;
