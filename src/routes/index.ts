import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import publicRouter from "./public";
import engagementRouter from "./engagement";
import meRouter from "./me";
import writerRouter from "./writer";
import adminRouter from "./admin";
import adminCrmRouter from "./admin-crm";
import seoRouter from "./seo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(publicRouter);
router.use(engagementRouter);
router.use(meRouter);
router.use(writerRouter);
router.use(adminRouter);
router.use(adminCrmRouter);
router.use(seoRouter);

export default router;
