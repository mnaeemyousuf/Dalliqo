import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app.dart';
import 'core/database/app_database.dart';
import 'core/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting();
  final db = await AppDatabase.open();
  runApp(ProviderScope(overrides: [databaseProvider.overrideWithValue(db)], child: const CrmApp()));
}
