# -*- coding: utf-8 -*-
"""Do not swap list-batch rows just because cum_nav_withdrawal > cumulative_nav.

That comparison is also true after a correct repair when 累计 is genuinely
above 复权, and running it again would put those columns back in the wrong
order. The repair that already ran is _repair_friday_list_nav_apply.sql.
It only exchanges columns when the stored pair still matches the reversed
Friday list mapping.
"""


def main() -> int:
    print(
        "Refusing to swap every list row with cum_nav_withdrawal > cumulative_nav. "
        "The repair that ran is scripts/ma/_repair_friday_list_nav_apply.sql."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
