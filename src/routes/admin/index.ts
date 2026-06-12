import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middleware/requireRole";
import dashboardRouter from "./dashboard";
import articlesRouter from "./articles";
import usersRouter from "./users";
import categoriesRouter from "./categories";
import locationsRouter from "./locations";
import moderationRouter from "./moderation";
import teamRouter from "./team";
import auditRouter from "./audit";

const router: IRouter = Router();
router.use(requireAdmin);

router.use(dashboardRouter);
router.use(articlesRouter);
router.use(usersRouter);
router.use(categoriesRouter);
router.use(locationsRouter);
router.use(moderationRouter);
router.use(teamRouter);
router.use(auditRouter);

export default router;
